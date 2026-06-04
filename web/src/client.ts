// SpikeClient — orchestrates the full connection lifecycle per spec/SSP-CLIENT-v0.8.md.
// Mirrors LegoSpikeConnectivity.java's upload controller and frame routing.
//
// Connect sequence:
//   transport.connect() → InfoRequest → InfoResponse (adopt maxPacketSize/maxChunkSize)
//   → hash check (localStorage) → fast-path ProgramFlow OR full upload
//   → wait for capability TunnelMessage → emit "connected" → start heartbeat
import type { Transport } from "./transport.js";
import { pack, unpack } from "./framing.js";
import { infoRequest, tunnel, clearSlot, programFlow } from "./messages.js";
import { buildUpload } from "./uploader.js";
import { buildCommand, parseEvents, type SSPCommand, type SSPEvent } from "./ssp.js";

const CONTROLLER_SLOT   = 0;
const HEARTBEAT_MS      = 5000;
const PONG_TIMEOUT_MS   = 10000;
const PREFS_KEY_PREFIX  = "solaria_phash_";

// ─── InfoResponse (17-byte wire format, offsets from ResponseParser.java) ───────
interface InfoResponse {
  maxPacketSize: number;
  maxMessageSize: number;
  maxChunkSize: number;
  fwMajor: number; fwMinor: number; fwBuild: number;
}

function parseInfoResponse(raw: Uint8Array): InfoResponse | null {
  if (raw.length < 17 || raw[0] !== 0x01) return null;
  const u16le = (o: number) => raw[o] | (raw[o + 1] << 8);
  return {
    fwMajor:       raw[5], fwMinor: raw[6], fwBuild: u16le(7),
    maxPacketSize: u16le(9),
    maxMessageSize:u16le(11),
    maxChunkSize:  u16le(13),
  };
}

function parseStatusOk(raw: Uint8Array): boolean {
  return raw.length >= 2 && raw[1] === 0x00;
}

// djb2 hash — same purpose as Java's String.hashCode(): cheap per-device upload cache key.
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

// ─── SpikeClient ─────────────────────────────────────────────────────────────────
export type ClientEvent =
  | { type: "connected"; deviceName: string; capability: Record<string, unknown> }
  | { type: "disconnected"; reason: string }
  | { type: "ssp"; event: SSPEvent }
  | { type: "error"; message: string };

export class SpikeClient {
  // RX reassembly
  private rxBuffer: number[] = [];

  // Pending one-shot waiters
  private infoWaiter:       ((r: InfoResponse) => void) | null = null;
  private uploadAckQueue:   Array<(raw: Uint8Array) => void> = [];
  private capabilityWaiter: ((cap: Record<string, unknown>) => void) | null = null;

  // Listeners
  private listeners: ((e: ClientEvent) => void)[] = [];

  // Heartbeat
  private lastPong    = 0;
  private heartbeat?: ReturnType<typeof setInterval>;

  // Disconnect guard — prevents double-emit if heartbeat timeout and transport drop race
  private disconnected = true; // starts true; flipped false at connect(), true at emitDisconnected()

  // Debug logging (mirrors App Inventor's DebugMode property)
  private debug = false;

  // Device identity (set after BLE pairing — used for hash cache key)
  private deviceId    = "unknown";
  private programHash: string;

  constructor(
    private transport: Transport,
    private hubProgram: string,
  ) {
    this.programHash = djb2(hubProgram);
  }

  on(cb: (e: ClientEvent) => void) { this.listeners.push(cb); }
  off(cb: (e: ClientEvent) => void) {
    const i = this.listeners.indexOf(cb);
    if (i >= 0) this.listeners.splice(i, 1);
  }

  /** Toggle verbose console.debug output (mirrors App Inventor DebugMode). */
  setDebug(enabled: boolean): void { this.debug = enabled; }

  // Full connect lifecycle. MUST be called from a user gesture (Web Bluetooth).
  async connect(): Promise<void> {
    this.disconnected = false;
    this.transport.onReceive((b) => this.onBytes(b));
    // Wire transport-level drop detection (e.g. gattserverdisconnected) so an
    // unexpected physical drop fires disconnected("connection_lost") immediately.
    this.transport.onDisconnect?.(() => this.emitDisconnected("connection_lost"));
    await this.transport.connect();

    // ── 1. InfoRequest → InfoResponse ──────────────────────────────────────
    const info = await this.sendAndAwait<InfoResponse>(
      pack(infoRequest()),
      (resolve) => { this.infoWaiter = resolve; },
      5000,
      "InfoResponse timeout",
    );
    this.transport.maxPacketSize = info.maxPacketSize || 20;
    const maxChunk = info.maxChunkSize || 960;
    this.log(`FW ${info.fwMajor}.${info.fwMinor}.${info.fwBuild}  maxPacket=${this.transport.maxPacketSize}  maxChunk=${maxChunk}`);

    // ── 2. Fast-path: skip upload if this device already has current program ─
    const cached = this.getCachedHash(this.deviceId);
    if (cached === this.programHash) {
      this.log("hash match — fast path (ProgramFlow only)");
      await this.transport.write(pack(programFlow(false, CONTROLLER_SLOT)));
      const cap = await this.awaitCapability(4000).catch(() => null);
      if (cap) {
        this.emit({ type: "connected", deviceName: this.deviceId, capability: cap });
        this.startHeartbeat();
        return;
      }
      this.log("fast path failed — falling through to full upload");
    }

    // ── 3. Full upload sequence ─────────────────────────────────────────────
    const frames = buildUpload(this.hubProgram, CONTROLLER_SLOT, maxChunk);

    // ClearSlot → 0x47 ack (NACK is acceptable — slot may already be empty)
    await this.transport.write(frames.clear);
    await this.awaitUploadAck(3000).catch(() => { /* 0x47 NACK is non-fatal */ });

    // StartFileUpload → 0x0D ack
    await this.transport.write(frames.start);
    const startAck = await this.awaitUploadAck(5000);
    if (!parseStatusOk(startAck)) throw new Error("StartFileUpload rejected by hub");

    // TransferChunks → 0x11 ack each
    for (let i = 0; i < frames.chunks.length; i++) {
      await this.transport.write(frames.chunks[i]);
      const chunkAck = await this.awaitUploadAck(5000);
      if (!parseStatusOk(chunkAck)) throw new Error(`Chunk ${i + 1}/${frames.chunks.length} rejected`);
    }
    this.log(`${frames.chunks.length} chunk(s) uploaded`);

    // ProgramFlow(start) → 0x1F ack
    await this.transport.write(frames.execute);
    await this.awaitUploadAck(5000).catch(() => { /* 0x1F ack optional */ });

    // Cache hash so next reconnect can skip upload
    this.setCachedHash(this.deviceId, this.programHash);

    // ── 4. Wait for capability TunnelMessage ────────────────────────────────
    const cap = await this.awaitCapability(3000).catch(() => ({} as Record<string, unknown>));
    this.emit({ type: "connected", deviceName: this.deviceId, capability: cap });
    this.startHeartbeat();
  }

  async sendSSP(cmd: SSPCommand): Promise<void> {
    await this.transport.write(pack(tunnel(buildCommand(cmd))));
  }

  async disconnect(): Promise<void> {
    this.stopHeartbeat();
    await this.transport.disconnect();
    this.emitDisconnected("user");
  }

  // ─── RX reassembly ──────────────────────────────────────────────────────────
  private onBytes(bytes: Uint8Array): void {
    for (const b of bytes) {
      this.rxBuffer.push(b);
      if (b === 0x02) {
        const frame = Uint8Array.from(this.rxBuffer);
        this.rxBuffer = [];
        try { this.handleFrame(unpack(frame)); } catch { /* partial/garbage */ }
      }
    }
  }

  private handleFrame(raw: Uint8Array): void {
    if (raw.length === 0) return;
    const msgId = raw[0];

    if (msgId === 0x01) {
      // InfoResponse
      const info = parseInfoResponse(raw);
      if (info && this.infoWaiter) { this.infoWaiter(info); this.infoWaiter = null; }

    } else if (msgId === 0x0d || msgId === 0x11 || msgId === 0x1f || msgId === 0x47) {
      // Upload status ack — deliver to head of queue
      const waiter = this.uploadAckQueue.shift();
      if (waiter) waiter(raw);

    } else if (msgId === 0x20) {
      if (raw.length >= 2)
        this.log(`ProgramFlow: ${raw[1] === 0 ? "started" : "stopped"}`);

    } else if (msgId === 0x21) {
      // Hub PRINT (console output from hub program)
      if (raw.length > 1) {
        let len = raw.length - 1;
        while (len > 0 && raw[len] === 0) len--;
        this.log("HUB PRINT: " + new TextDecoder().decode(raw.subarray(1, len + 1)).trim());
      }

    } else if (msgId === 0x32) {
      // TunnelMessage: [0x32][sizeU16LE][utf8]
      if (raw.length < 3) return;
      const size = raw[1] | (raw[2] << 8);
      const text = new TextDecoder().decode(raw.subarray(3, 3 + size)).trim();
      if (!text || text === "rdy" || text === "err") return;

      for (const ev of parseEvents(text)) {
        const any = ev as Record<string, unknown>;

        // Capability message
        if (any["type"] === "capability" && this.capabilityWaiter) {
          this.capabilityWaiter(any);
          this.capabilityWaiter = null;
        }

        // Pong heartbeat
        if (any["event"] === "pong") this.lastPong = performance.now();

        this.emit({ type: "ssp", event: ev });
      }
    }
  }

  // ─── Heartbeat ──────────────────────────────────────────────────────────────
  private startHeartbeat(): void {
    this.lastPong = performance.now();
    this.heartbeat = setInterval(() => {
      this.sendSSP({ cmd: "system.ping" }).catch(() => {});
      if (performance.now() - this.lastPong > PONG_TIMEOUT_MS) {
        this.stopHeartbeat();
        this.emitDisconnected("heartbeat_lost");
      }
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat != null) { clearInterval(this.heartbeat); this.heartbeat = undefined; }
  }

  // ─── Promise helpers ────────────────────────────────────────────────────────
  private sendAndAwait<T>(
    msg: Uint8Array,
    registerWaiter: (resolve: (v: T) => void) => void,
    timeoutMs: number,
    timeoutMsg: string,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(timeoutMsg)), timeoutMs);
      registerWaiter((v: T) => { clearTimeout(timer); resolve(v); });
      this.transport.write(msg).catch(reject);
    });
  }

  private awaitUploadAck(timeoutMs: number): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.uploadAckQueue.indexOf(resolve);
        if (idx >= 0) this.uploadAckQueue.splice(idx, 1);
        reject(new Error("Upload ack timeout"));
      }, timeoutMs);
      this.uploadAckQueue.push((raw) => { clearTimeout(timer); resolve(raw); });
    });
  }

  private awaitCapability(timeoutMs: number): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.capabilityWaiter = null;
        reject(new Error("Capability timeout"));
      }, timeoutMs);
      this.capabilityWaiter = (cap) => { clearTimeout(timer); resolve(cap); };
    });
  }

  // ─── Program hash cache (localStorage, keyed by BLE device ID) ──────────────
  private getCachedHash(deviceId: string): string | null {
    try { return localStorage.getItem(PREFS_KEY_PREFIX + deviceId); } catch { return null; }
  }

  private setCachedHash(deviceId: string, hash: string): void {
    try { localStorage.setItem(PREFS_KEY_PREFIX + deviceId, hash); } catch { /* no-op in non-browser */ }
  }

  // ─── Internal helpers ────────────────────────────────────────────────────────
  private emit(e: ClientEvent): void { this.listeners.forEach((l) => l(e)); }

  /** Single exit point for all disconnect paths — guards against double-emit. */
  private emitDisconnected(reason: string): void {
    if (this.disconnected) return;
    this.disconnected = true;
    this.stopHeartbeat();
    this.emit({ type: "disconnected", reason });
  }

  private log(msg: string): void {
    if (this.debug) console.debug("[SpikeClient]", msg);
  }
}

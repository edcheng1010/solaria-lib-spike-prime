// SpikeClient — orchestrates the connection lifecycle per spec/SSP-CLIENT-v0.8.md.
// Mirrors LegoSpikeConnectivity.java. The hub program text is injected at construction
// (the Scratch build bundles hub/hub_controller.py as a string).
import type { Transport } from "./transport.js";
import { pack, unpack } from "./framing.js";
import { infoRequest, tunnel } from "./messages.js";
import { buildUpload } from "./uploader.js";
import { buildCommand, parseEvents, type SSPCommand, type SSPEvent } from "./ssp.js";

const HEARTBEAT_MS = 5000;
const PONG_TIMEOUT_MS = 10000;

export class SpikeClient {
  private rxBuffer: number[] = [];
  private listeners: ((e: SSPEvent) => void)[] = [];
  private lastPong = 0;
  private heartbeat?: ReturnType<typeof setInterval>;

  constructor(private transport: Transport, private hubProgram: string) {}

  onEvent(cb: (e: SSPEvent) => void) { this.listeners.push(cb); }

  // Full connect lifecycle. Call from a user gesture (Web Bluetooth requirement).
  async connect(): Promise<void> {
    this.transport.onReceive((b) => this.onBytes(b));
    await this.transport.connect();
    // TODO: send InfoRequest, await InfoResponse, adopt maxPacketSize/maxChunkSize.
    await this.transport.write(pack(infoRequest()));
    // TODO: upload sequence (await status acks). Frames ready via:
    //   const u = buildUpload(this.hubProgram, 0, maxChunkSize);
    // TODO: await capability TunnelMessage; check ssp_version.
    // TODO: startHeartbeat();
  }

  async sendSSP(cmd: SSPCommand): Promise<void> {
    await this.transport.write(pack(tunnel(buildCommand(cmd))));
  }

  // Reassemble TX notifications into 0x02-delimited frames, unpack, route.
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

  private handleFrame(payload: Uint8Array): void {
    if (payload[0] === 0x32) {
      // TunnelMessage: [0x32][sizeU16LE][utf8]
      const size = payload[1] | (payload[2] << 8);
      const text = new TextDecoder().decode(payload.subarray(3, 3 + size));
      for (const ev of parseEvents(text)) {
        if ((ev as any).event === "pong") this.lastPong = performance.now();
        this.listeners.forEach((l) => l(ev));
      }
    }
    // TODO: handle InfoResponse (0x01) and status acks (0x0D/0x11/0x1F/0x47).
  }

  private startHeartbeat(): void {
    this.lastPong = performance.now();
    this.heartbeat = setInterval(() => {
      this.sendSSP({ cmd: "system.ping" });
      if (performance.now() - this.lastPong > PONG_TIMEOUT_MS) {
        // TODO: emit disconnected("heartbeat_lost")
      }
    }, HEARTBEAT_MS);
  }
}

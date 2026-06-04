// Transport abstraction — decouples the SSP client from the BLE mechanism.
// WebBleTransport (transport-webble.ts) implements this for TurboWarp/PenguinMod.
// A future ScratchLinkTransport can implement the same interface for official scratch.mit.edu.

export interface Transport {
  // Must be triggered from a user gesture (Web Bluetooth requirement).
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  // Write one already-framed message; implementation splits to maxPacketSize.
  write(framed: Uint8Array): Promise<void>;
  // Register a callback for raw inbound notification bytes (un-reassembled).
  onReceive(cb: (bytes: Uint8Array) => void): void;
  // Optional: register a callback fired when the transport detects an unexpected
  // physical drop (e.g. gattserverdisconnected). SpikeClient uses this to emit
  // disconnected("connection_lost") immediately rather than waiting for heartbeat timeout.
  onDisconnect?(cb: () => void): void;
  // Updated by SpikeClient after InfoResponse is parsed.
  maxPacketSize: number;
}

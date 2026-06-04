// Web Bluetooth transport for SPIKE Prime. Implements Transport using navigator.bluetooth.
// Runs in TurboWarp/PenguinMod unsandboxed extensions (page script context) — no Scratch Link.
import type { Transport } from "./transport.js";

export const SERVICE_UUID = "0000fd02-0000-1000-8000-00805f9b34fb";
export const RX_UUID = "0000fd02-0001-1000-8000-00805f9b34fb"; // write (client→hub)
export const TX_UUID = "0000fd02-0002-1000-8000-00805f9b34fb"; // notify (hub→client)

export interface WebBleTransportOptions {
  // Optional BLE device name prefix filter (mirrors App Inventor's CustomDeviceName).
  // Narrows the browser's device chooser beyond the service UUID filter.
  namePrefix?: string;
}

export class WebBleTransport implements Transport {
  maxPacketSize = 20; // raised after InfoResponse
  private gatt?: BluetoothRemoteGATTServer;
  private rx?: BluetoothRemoteGATTCharacteristic;
  private tx?: BluetoothRemoteGATTCharacteristic;
  private rxCb?: (b: Uint8Array) => void;
  private disconnectCb?: () => void;

  constructor(private opts: WebBleTransportOptions = {}) {}

  // MUST be called from a user gesture (block click).
  async connect(): Promise<void> {
    const filter: BluetoothLEScanFilter = { services: [SERVICE_UUID] };
    if (this.opts.namePrefix) (filter as any).namePrefix = this.opts.namePrefix;
    const dev = await navigator.bluetooth.requestDevice({ filters: [filter] });

    // Listen for unexpected physical drops (hub powered off / out of range).
    // Fires immediately rather than waiting up to 10 s for heartbeat timeout.
    dev.addEventListener("gattserverdisconnected", () => this.disconnectCb?.());

    const gatt = await dev.gatt!.connect();
    this.gatt = gatt;
    const svc = await gatt.getPrimaryService(SERVICE_UUID);
    this.rx = await svc.getCharacteristic(RX_UUID);
    this.tx = await svc.getCharacteristic(TX_UUID);
    await this.tx.startNotifications();
    this.tx.addEventListener("characteristicvaluechanged", (e: Event) => {
      const dv = (e.target as BluetoothRemoteGATTCharacteristic).value!;
      this.rxCb?.(new Uint8Array(dv.buffer));
    });
  }

  async disconnect(): Promise<void> {
    try { this.gatt?.disconnect(); } catch { /* ignore */ }
    this.gatt = undefined;
    this.rx   = undefined;
    this.tx   = undefined;
  }

  async write(framed: Uint8Array): Promise<void> {
    if (!this.rx) throw new Error("not connected");
    for (let i = 0; i < framed.length; i += this.maxPacketSize) {
      const slice = framed.subarray(i, Math.min(i + this.maxPacketSize, framed.length));
      // writeValueWithoutResponse preferred; pacing may be needed for throughput.
      await this.rx.writeValueWithoutResponse(new Uint8Array(slice));
    }
  }

  onReceive(cb: (bytes: Uint8Array) => void): void { this.rxCb = cb; }
  onDisconnect(cb: () => void): void               { this.disconnectCb = cb; }
}

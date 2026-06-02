// Web Bluetooth transport for SPIKE Prime. Implements Transport using navigator.bluetooth.
// Runs in TurboWarp/PenguinMod unsandboxed extensions (page script context) — no Scratch Link.
import type { Transport } from "./transport.js";

export const SERVICE_UUID = "0000fd02-0000-1000-8000-00805f9b34fb";
export const RX_UUID = "0000fd02-0001-1000-8000-00805f9b34fb"; // write (client→hub)
export const TX_UUID = "0000fd02-0002-1000-8000-00805f9b34fb"; // notify (hub→client)

export class WebBleTransport implements Transport {
  maxPacketSize = 20; // raised after InfoResponse
  private rx?: BluetoothRemoteGATTCharacteristic;
  private tx?: BluetoothRemoteGATTCharacteristic;
  private rxCb?: (b: Uint8Array) => void;

  // MUST be called from a user gesture (block click).
  async connect(): Promise<void> {
    const dev = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE_UUID] }],
    });
    const gatt = await dev.gatt!.connect();
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
    // TODO: track device.gatt and disconnect
  }

  async write(framed: Uint8Array): Promise<void> {
    if (!this.rx) throw new Error("not connected");
    for (let i = 0; i < framed.length; i += this.maxPacketSize) {
      const slice = framed.subarray(i, Math.min(i + this.maxPacketSize, framed.length));
      // writeValueWithoutResponse preferred; pacing may be needed for throughput.
      await this.rx.writeValueWithoutResponse(new Uint8Array(slice));
    }
  }

  onReceive(cb: (bytes: Uint8Array) => void): void {
    this.rxCb = cb;
  }
}

// SSP message builders. Ported from MessageBuilder.java. All multi-byte values little-endian.
import { calculate, toLE } from "./crc32.js";

const enc = new TextEncoder();

export function infoRequest(): Uint8Array {
  return new Uint8Array([0x00]);
}

export function clearSlot(slot: number): Uint8Array {
  return new Uint8Array([0x46, slot & 0xff]);
}

// 0x0C + name(UTF-8) + 0x00 + slot(u8) + fileCRC32(u32 LE).
// fileCRC = calculate(programBytes, 0) over the WHOLE program (4-byte padded internally).
export function startFileUpload(name: string, slot: number, programBytes: Uint8Array): Uint8Array {
  const n = enc.encode(name);
  const crc = toLE(calculate(programBytes, 0));
  const out = new Uint8Array(1 + n.length + 1 + 1 + 4);
  let i = 0;
  out[i++] = 0x0c;
  out.set(n, i); i += n.length;
  out[i++] = 0x00;          // null terminator
  out[i++] = slot & 0xff;
  out.set(crc, i);
  return out;
}

// 0x10 + runningCRC32(u32 LE) + size(u16 LE) + chunk
export function transferChunk(chunk: Uint8Array, runningCRC: number): Uint8Array {
  const out = new Uint8Array(1 + 4 + 2 + chunk.length);
  out[0] = 0x10;
  out.set(toLE(runningCRC), 1);
  out[5] = chunk.length & 0xff;
  out[6] = (chunk.length >>> 8) & 0xff;
  out.set(chunk, 7);
  return out;
}

// 0x1E + stop(0=start,1=stop) + slot
export function programFlow(stop: boolean, slot: number): Uint8Array {
  return new Uint8Array([0x1e, stop ? 1 : 0, slot & 0xff]);
}

// 0x32 + size(u16 LE) + UTF-8 payload (carries one SSP JSON line)
export function tunnel(payload: string): Uint8Array {
  const p = enc.encode(payload);
  const out = new Uint8Array(3 + p.length);
  out[0] = 0x32;
  out[1] = p.length & 0xff;
  out[2] = (p.length >>> 8) & 0xff;
  out.set(p, 3);
  return out;
}

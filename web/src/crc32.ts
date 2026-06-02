// CRC-32/ISO-HDLC (poly 0xEDB88320, reflected), with SPIKE-specific 4-byte zero padding
// and running-CRC seed support. Ported from SpikeCRC32.java.

const TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n >>> 0;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

// calculate(data, seed=0): zero-pad data to a 4-byte boundary, then CRC32 with seed
// as a resumable running checksum. Returns unsigned 32-bit.
export function calculate(data: Uint8Array, seed = 0): number {
  const pad = (4 - (data.length % 4)) % 4;
  let state = (seed ^ 0xffffffff) >>> 0;
  const run = (b: number) => {
    state = ((state >>> 8) ^ TABLE[(state ^ b) & 0xff]) >>> 0;
  };
  for (let i = 0; i < data.length; i++) run(data[i] & 0xff);
  for (let i = 0; i < pad; i++) run(0);
  return (state ^ 0xffffffff) >>> 0;
}

// little-endian 4 bytes
export function toLE(crc: number): Uint8Array {
  return new Uint8Array([crc & 0xff, (crc >>> 8) & 0xff, (crc >>> 16) & 0xff, (crc >>> 24) & 0xff]);
}

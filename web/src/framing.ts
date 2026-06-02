// Frame wrapper. Ported from MessageFramer.java.
//   pack(raw)   = [0x01] + (COBS(raw) each byte ^ 0x03) + [0x02]
//   unpack(fr)  = skip leading 0x01 if present, drop trailing 0x02,
//                 XOR ^0x03 each byte, then COBS.decode
import { encode, decode, XOR, DELIMITER } from "./cobs.js";

const FRAME_START = 0x01;

export function pack(raw: Uint8Array): Uint8Array {
  const cobs = encode(raw);
  const out = new Uint8Array(cobs.length + 2);
  out[0] = FRAME_START;
  for (let i = 0; i < cobs.length; i++) out[i + 1] = (cobs[i] ^ XOR) & 0xff;
  out[out.length - 1] = DELIMITER;
  return out;
}

export function unpack(frame: Uint8Array): Uint8Array {
  const start = frame[0] === FRAME_START ? 1 : 0;
  const bodyLen = frame.length - start - 1; // exclude trailing DELIMITER
  const unxored = new Uint8Array(bodyLen);
  for (let i = 0; i < bodyLen; i++) unxored[i] = (frame[start + i] ^ XOR) & 0xff;
  return decode(unxored);
}

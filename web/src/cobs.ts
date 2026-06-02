// COBS (Consistent Overhead Byte Stuffing) + XOR-0x03 masking.
// Ported from COBSEncoder.java in appinventor-lego-spike-prime-extension.
//
// Constants (DO NOT CHANGE — SPIKE Prime 3.x wire protocol):
export const DELIMITER = 0x02;
export const NO_DELIMITER = 0xff;
export const MAX_BLOCK_SIZE = 84;
export const COBS_CODE_OFFSET = 0x02;
export const XOR = 0x03;

// encode(data): COBS-encode raw bytes.
//   - code word starts at 0xFF (NO_DELIMITER); for each byte:
//       b > 0x02            → append, block++
//       b <= 0x02 or block>84 → finalize code word (b<=0x02 → code = b*84 + (block+2)),
//                               start new block
//   - finalize last block's code word to (block + COBS_CODE_OFFSET)
// TODO: port encode()
export function encode(data: Uint8Array): Uint8Array {
  throw new Error("TODO: port COBSEncoder.encode");
}

// decode(data): inverse of encode. unescape(code): 0xFF→{value:-1,block:85};
//   else value=(code-2)/84, block=(code-2)%84 (block==0 adjustment per Java).
// TODO: port decode()
export function decode(data: Uint8Array): Uint8Array {
  throw new Error("TODO: port COBSEncoder.decode");
}

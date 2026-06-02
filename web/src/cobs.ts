// COBS (Consistent Overhead Byte Stuffing) + XOR-0x03 masking.
// Ported 1:1 from COBSEncoder.java (faithfully translated from LEGO's cobs.py).
// Escapes all bytes <= DELIMITER (0x00, 0x01, 0x02).
//
// Wire pipeline (outbound):  encode() -> XOR each byte ^ 0x03 -> (caller prepends 0x01 and appends 0x02)
// Wire pipeline (inbound):   strip 0x01 / 0x02 -> XOR -> decode()
// Both are handled by framing.ts (pack / unpack).

export const DELIMITER        = 0x02;
export const NO_DELIMITER     = 0xff;
export const MAX_BLOCK_SIZE   = 84;
export const COBS_CODE_OFFSET = 0x02; // == DELIMITER
export const XOR              = 0x03;

export function encode(data: Uint8Array): Uint8Array {
  // Worst case: every byte is a delimiter → output doubles
  const buf = new Uint8Array(data.length * 2 + 2);
  let bufLen = 0;

  // begin_block
  let codeIndex = bufLen;
  buf[bufLen++] = NO_DELIMITER;
  let block = 1;

  for (let idx = 0; idx < data.length; idx++) {
    const b = data[idx] & 0xff;

    if (b > DELIMITER) {
      buf[bufLen++] = b;
      block++;
    }

    if (b <= DELIMITER || block > MAX_BLOCK_SIZE) {
      if (b <= DELIMITER) {
        const delimiterBase = b * MAX_BLOCK_SIZE;
        const blockOffset   = block + COBS_CODE_OFFSET;
        buf[codeIndex]      = (delimiterBase + blockOffset) & 0xff;
      }
      // begin_block
      codeIndex = bufLen;
      buf[bufLen++] = NO_DELIMITER;
      block = 1;
    }
  }

  // finalise last block's code word
  buf[codeIndex] = (block + COBS_CODE_OFFSET) & 0xff;

  return buf.subarray(0, bufLen);
}

export function decode(data: Uint8Array): Uint8Array {
  const buf = new Uint8Array(data.length);
  let bufLen = 0;

  let [value, block] = unescape(data[0] & 0xff);

  for (let i = 1; i < data.length; i++) {
    const b = data[i] & 0xff;
    block--;
    if (block > 0) {
      buf[bufLen++] = b;
      continue;
    }
    // block completed — emit the delimiter value if there was one
    if (value !== -1) {
      buf[bufLen++] = value & 0xff;
    }
    [value, block] = unescape(b);
  }

  return buf.subarray(0, bufLen);
}

// Translate a COBS code word into [delimiterValue, blockSize].
// delimiterValue == -1 signals NO_DELIMITER (maps to Python None).
function unescape(code: number): [number, number] {
  if (code === NO_DELIMITER) {
    return [-1, MAX_BLOCK_SIZE + 1];
  }
  const div  = code - COBS_CODE_OFFSET;
  let value  = Math.floor(div / MAX_BLOCK_SIZE);
  let blk    = div % MAX_BLOCK_SIZE;
  if (blk === 0) {
    blk = MAX_BLOCK_SIZE;
    value -= 1;
  }
  return [value, blk];
}

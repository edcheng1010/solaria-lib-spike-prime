// cobs.test.ts — Vitest unit tests for COBS encode/decode + framing.
// Every test case mirrors the Java COBSEncoder + MessageFramer behaviour.

import { describe, it, expect } from "vitest";
import { encode, decode } from "./cobs.js";
import { pack, unpack } from "./framing.js";

// helpers
const u8 = (...bytes: number[]) => new Uint8Array(bytes);
const hex = (a: Uint8Array) => Array.from(a).map(b => b.toString(16).padStart(2, "0")).join(" ");

function roundTrip(input: Uint8Array) {
  const encoded = encode(input);
  const decoded = decode(encoded);
  expect(hex(decoded)).toBe(hex(input));
}

// ─────────────────────────────────────────────────────────────
// 1. Encode: no special bytes → single block, code word = len+2
// ─────────────────────────────────────────────────────────────
describe("encode — normal data", () => {
  it("empty input", () => {
    // encode([]) = [0x03] (block=1, code = 1+2 = 3 = 0x03)
    expect(hex(encode(u8()))).toBe("03");
  });

  it("single non-special byte 0x05", () => {
    // block=2, code=4=0x04; body=[0x05]
    expect(hex(encode(u8(0x05)))).toBe("04 05");
  });

  it("three non-special bytes", () => {
    // block=4, code=0x06; body=[0x10 0x20 0x30]
    expect(hex(encode(u8(0x10, 0x20, 0x30)))).toBe("06 10 20 30");
  });
});

// ─────────────────────────────────────────────────────────────
// 2. Encode: special bytes (0x00, 0x01, 0x02) → code word encodes delimiter
// ─────────────────────────────────────────────────────────────
describe("encode — delimiter bytes", () => {
  it("single 0x00", () => {
    // b=0x00: delimiterBase=0*84=0, block=1, blockOffset=1+2=3 → code=3; begin new block code=0x03
    // second code: block=1 → code=3
    expect(hex(encode(u8(0x00)))).toBe("03 03");
  });

  it("single 0x01", () => {
    // delimiterBase=1*84=84=0x54, block=1, blockOffset=3 → code=87=0x57; new code=0x03
    expect(hex(encode(u8(0x01)))).toBe("57 03");
  });

  it("single 0x02", () => {
    // delimiterBase=2*84=168=0xa8, block=1, blockOffset=3 → code=171=0xab; new code=0x03
    expect(hex(encode(u8(0x02)))).toBe("ab 03");
  });

  it("sequence 0x00 0x00", () => {
    // first 0x00: code=3 ; second 0x00: code=3 ; final code=3
    expect(hex(encode(u8(0x00, 0x00)))).toBe("03 03 03");
  });

  it("0x00 then normal byte then 0x02", () => {
    // 0x00 → code=3; begin new block, push 0x05, block=2; 0x02 → code = 2*84+4=172=0xac; final code=3
    expect(hex(encode(u8(0x00, 0x05, 0x02)))).toBe("03 ac 05 03");
  });
});

// ─────────────────────────────────────────────────────────────
// 3. Round-trip identity
// ─────────────────────────────────────────────────────────────
describe("round-trip encode → decode", () => {
  it("empty", () => roundTrip(u8()));
  it("all zeros", () => roundTrip(new Uint8Array(10)));
  it("all 0x01", () => roundTrip(new Uint8Array(10).fill(0x01)));
  it("all 0x02", () => roundTrip(new Uint8Array(10).fill(0x02)));
  it("mixed low bytes", () => roundTrip(u8(0x00, 0x01, 0x02, 0x00, 0x01, 0x02)));
  it("all non-special", () => roundTrip(new Uint8Array(50).map((_, i) => i + 3)));
  it("arbitrary binary", () => roundTrip(new Uint8Array(256).map((_, i) => i)));
  it("run longer than MAX_BLOCK_SIZE (85 non-special bytes)", () => {
    // forces a block-overflow split at 84
    roundTrip(new Uint8Array(85).fill(0xff));
  });
  it("exactly MAX_BLOCK_SIZE non-special bytes", () => {
    roundTrip(new Uint8Array(84).fill(0xaa));
  });
  it("realistic SSP JSON TunnelMessage payload", () => {
    const json = '{"cmd":"motor.run","port":"A","speed":75}';
    const payload = new TextEncoder().encode(json);
    roundTrip(payload);
  });
});

// ─────────────────────────────────────────────────────────────
// 4. Encoded output contains NO bytes <= 0x02
// ─────────────────────────────────────────────────────────────
describe("encoded bytes are all > DELIMITER", () => {
  const cases: Uint8Array[] = [
    u8(),
    new Uint8Array(256).map((_, i) => i),
    new Uint8Array(10).fill(0x00),
    new Uint8Array(10).fill(0x01),
    new Uint8Array(10).fill(0x02),
    new Uint8Array(85).fill(0xff),
  ];
  for (const c of cases) {
    it(`input len=${c.length}`, () => {
      const enc = encode(c);
      for (const b of enc) {
        expect(b).toBeGreaterThan(0x02);
      }
    });
  }
});

// ─────────────────────────────────────────────────────────────
// 5. pack / unpack (framing.ts end-to-end)
//    pack = [0x01] + (COBS(raw) ^ 0x03 each) + [0x02]
//    unpack = inverse
// ─────────────────────────────────────────────────────────────
describe("framing pack / unpack round-trip", () => {
  const cases = [
    u8(),
    u8(0x32, 0x00, 0x00),                // TunnelMessage opcode with zero args
    new Uint8Array(256).map((_, i) => i), // all bytes 0x00–0xff
    new Uint8Array(85).fill(0xff),
    (() => {
      const json = '{"cmd":"motor.run","port":"A","speed":75}';
      return new TextEncoder().encode("\x32" + String.fromCharCode(json.length, 0) + json);
    })(),
  ];

  for (const raw of cases) {
    it(`len=${raw.length}`, () => {
      const framed   = pack(raw);
      // first byte must be 0x01, last must be 0x02
      expect(framed[0]).toBe(0x01);
      expect(framed[framed.length - 1]).toBe(0x02);
      // body bytes (1..len-2) must not contain 0x01 or 0x02
      for (let i = 1; i < framed.length - 1; i++) {
        expect(framed[i]).not.toBe(0x01);
        expect(framed[i]).not.toBe(0x02);
      }
      const recovered = unpack(framed);
      expect(hex(recovered)).toBe(hex(raw));
    });
  }
});

# @solaria/spike-prime (web)

TypeScript SSP client for LEGO® SPIKE™ Prime over **Web Bluetooth**. Powers the Scratch extension
(`solaria-scratch-spike-prime`) and a standalone Web/JS client later.

## Modules (port status)

| File | Role | Status |
|------|------|--------|
| `cobs.ts` | COBS + XOR-0x03 codec | ⬜ stub (constants + algorithm doc) |
| `framing.ts` | 0x01/0x02 frame wrapper | ✅ logic ported (depends on cobs) |
| `crc32.ts` | CRC32, 4-byte pad, running seed | ✅ ported |
| `messages.ts` | message builders (0x00/0x0C/0x10/0x1E/0x32/0x46) | ✅ ported |
| `uploader.ts` | upload sequence | ✅ ported |
| `ssp.ts` | SSP JSON command/event envelope | ✅ ported |
| `transport.ts` | transport interface | ✅ |
| `transport-webble.ts` | Web Bluetooth transport | 🟨 connect/write done, disconnect TODO |
| `client.ts` | connection lifecycle orchestrator | 🟨 skeleton; InfoResponse/upload/heartbeat TODO |

## Remaining work (see ../PHASE_4A_PLAN.md)
1. Port `cobs.ts` encode/decode (the only un-ported algorithm).
2. Wire `client.ts`: InfoResponse parse → upload (await acks) → capability → heartbeat.
3. Vitest vectors from `solaria-appinventor-spike-prime/docs/deep_analysis/04_cobs_test_vectors.md`.
4. `esbuild` bundle for the Scratch extension.

## Browser support
Web Bluetooth: Chrome / Edge / Opera (desktop + Android). Not Safari/Firefox. `requestDevice()` requires
a user gesture.

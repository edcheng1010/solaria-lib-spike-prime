# Phase 4a — Scratch Extension for LEGO® SPIKE™ Prime (via SSP)

**Status:** Planning · **Target:** TurboWarp/PenguinMod first (Web Bluetooth), official-Scratch path kept open
**Depends on:** SSP v0.8 (`solaria-hub/spec/SSP-v0.8.md`), hub program `hub_controller.py` (this repo)

## Context

App Inventor is the shipped client. Phase 4a brings the **second frontend — Scratch** — by reimplementing
the SSP client stack in TypeScript/JS and wrapping it as a Scratch 3.0 extension. The hub side
(`hub_controller.py`, SSP v0.8) is unchanged and remains the single source of truth.

**Decision:** Target **TurboWarp/PenguinMod** unsandboxed custom extensions, which run as page script tags
and have direct `navigator.bluetooth` (Web Bluetooth) access — **no Scratch Link required, zero install**.
Keep the JS bridge transport-abstracted so a Scratch-Link transport (for official scratch.mit.edu) can be
added later without touching protocol or block code.

## Repo layout (this phase creates two repos)

```
solaria-lib-spike-prime/            ← language-agnostic protocol library
  spec/SSP-CLIENT-v0.8.md           ← client contract (what ANY bridge must do) — keystone
  hub/hub_controller.py             ← canonical hub program (copied from extension; future single source)
  web/                              ← TypeScript SSP client (the bridge core for Scratch + Web)
    src/cobs.ts framing.ts crc32.ts messages.ts uploader.ts ssp.ts
        transport.ts transport-webble.ts client.ts index.ts
  java/   python/                   ← future reference SDKs (stubs only this phase)

solaria-scratch-spike-prime/        ← the Scratch extension
  extension.js                      ← TurboWarp unsandboxed extension (wraps web/ bridge, bundled)
```

## Work breakdown

### 4a.0 — SSP client contract spec (`spec/SSP-CLIENT-v0.8.md`)
Formalise what every bridge implements, language-neutral. Already drafted in this repo. Covers: BLE
discovery filter, COBS+XOR framing, file-upload sequence, capability handshake, heartbeat, JSON envelope.
The App Inventor Java client is the reference implementation.

### 4a.1 — JS protocol core (`web/src/`), port of the verified Java stack
Port these 1:1 (all constants/byte-layouts captured from the Java source — see inventory below):
- **cobs.ts** — COBS encode/decode. Constants: DELIMITER=0x02, NO_DELIMITER=0xFF, MAX_BLOCK_SIZE=84,
  COBS_CODE_OFFSET=0x02, XOR=0x03.
- **framing.ts** — frame = `0x01` + (COBS(payload) each byte XOR 0x03) + `0x02`; unpack reverses, skips
  optional 0x01 start, strips trailing 0x02.
- **crc32.ts** — CRC-32/ISO-HDLC (poly 0xEDB88320, reflected), **input zero-padded to 4-byte alignment**,
  running-CRC via seed; little-endian wire bytes.
- **messages.ts** — builders: InfoRequest `0x00`; ClearSlot `0x46 slot`; StartFileUpload
  `0x0C name\0 slot crc32LE`; TransferChunk `0x10 runningCRC32LE sizeU16LE data`;
  ProgramFlow `0x1E stop(0/1) slot`; TunnelMessage `0x32 sizeU16LE utf8`.
- **uploader.ts** — sequence: ClearSlot → StartFileUpload → N×TransferChunk (running CRC) → ProgramFlow(start).
  Chunk size from InfoResponse (default 960); each frame split to maxPacketSize (20) on write.
- **ssp.ts** — SSPMessage builder (`{cmd, port?, request_id?, ...params}` + `\n`) and SSPParser
  (newline-split JSON → capability / sensor / system / error / pong events).

### 4a.2 — Transport abstraction (`web/src/transport.ts` + `transport-webble.ts`)
- `Transport` interface: `connect(filter)`, `disconnect()`, `write(bytes)`, `onReceive(cb)`.
- `WebBleTransport` implements it via `navigator.bluetooth`:
  - `requestDevice({ filters:[{ services:[FD02] }] })` — **must be called from a user gesture** (see risks)
  - GATT connect → service FD02 → RX char (0001, write) + TX char (0002, notify)
  - `writeValueWithoutResponse` in ≤maxPacketSize chunks; reassemble TX notifications into frames (0x02-delimited)
- Keeping this an interface is what lets a `ScratchLinkTransport` slot in later for official Scratch.

### 4a.3 — Client orchestration (`web/src/client.ts`)
`SpikeClient` mirroring `LegoSpikeConnectivity`: connect → InfoResponse → upload `hub_controller.py`
(program-hash fast-path skip) → capability handshake (read `ssp_version`, degrade if mismatch) →
start 5s heartbeat (`system.ping`, 10s pong timeout) → expose `sendSSP()` + typed event emitters.
Bundle `hub_controller.py` text as a string asset at build time.

### 4a.4 — Scratch extension (`solaria-scratch-spike-prime/extension.js`)
Unsandboxed TurboWarp extension wrapping the bundled bridge. `getInfo()` block surface mirrors the 8
App Inventor components, same LEGO-aligned names. Block-type mapping:
- **command** — StartMotor, StopMotor, RunMotorForDuration, StartMoving, TurnOnLightMatrix,
  SetCenterButtonLight, Beep, PlayNoteForBeats, SetHubOrientation, etc.
- **reporter** — GetColor→(returns last ColorRead), GetDistance, GetHubTilt(axis), GetBatteryLevel,
  GetTempo … Scratch reporters are synchronous, so reads use the request→cache pattern: the command
  fires the SSP read and the reporter returns the latest cached value (document the one-tick latency).
- **Boolean** — IsColor, IsCloserThan, IsTilted, IsShaking, IsHubButtonPressed, IsCharging.
- **hat (`when`)** — WhenHubButtonPressed, WhenHubShaken (gesture), WhenColorChecked — driven by the
  subscription events the bridge emits.
- A **"connect to hub"** command/button triggers `WebBleTransport.connect()` from the click gesture.

### 4a.5 — Packaging & docs
- Bundle `web/` (esbuild/rollup) into a single `extension.js` for TurboWarp URL loading.
- README: how to load (TurboWarp → Add Extension → URL), Chrome/Edge requirement, connect flow.
- Host the built extension (GitHub Pages) for URL loading.

### 4a.6 — Parity verification
Run the Phase 3 hardware checklist (motors, movement, light, sensors, sound, music, system) through the
Scratch blocks against a real hub. Confirm block names/behaviour match the App Inventor surface.

## Risks
- **Web Bluetooth user gesture** — `requestDevice()` must run from a user gesture. Scratch block clicks in
  unsandboxed extensions generally qualify, but verify early; fall back to an extension-provided connect button.
- **Browser support** — Web Bluetooth is Chrome/Edge/Opera only (no Safari/Firefox). Document clearly.
- **Official Scratch** — scratch.mit.edu can't load custom extensions and needs Scratch Link; out of scope
  for 4a but unblocked later by the transport abstraction.
- **MTU / write pacing** — 20-byte writes with pacing; tune for Web Bluetooth throughput (may need small delays).
- **Hub program duplication** — `hub_controller.py` now lives in both the extension (embedded Java string)
  and here. Phase 4.2 makes this repo the single source; until then, keep them in sync on any protocol change.

## Verification
- Unit tests (Vitest) for cobs/crc32/messages against the Java test vectors (port `docs/deep_analysis/04_cobs_test_vectors.md`).
- Integration: connect + upload + drive a motor + read a sensor on a physical hub via TurboWarp.
- Parity: Phase 3 checklist subset green through Scratch blocks.

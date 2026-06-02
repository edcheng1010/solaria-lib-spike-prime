# SSP Client Contract — v0.8 (LEGO® SPIKE™ Prime profile)

**Status:** Draft · Companion to `solaria-hub/spec/SSP-v0.8.md`
**Purpose:** Define what ANY client/bridge must implement to talk to a SPIKE Prime hub over BLE,
independent of language. App Inventor (Java) is the reference implementation; Scratch (JS), Python,
and Web bridges all implement this same contract.

This document is the *transport + lifecycle* contract. The *command/event vocabulary* is SSP v0.8.

---

## 1. BLE profile

| Role | UUID |
|------|------|
| Service | `0000fd02-0000-1000-8000-00805f9b34fb` |
| RX (client→hub, write) | `0000fd02-0001-1000-8000-00805f9b34fb` |
| TX (hub→client, notify) | `0000fd02-0002-1000-8000-00805f9b34fb` |

- Discover/filter by the **service UUID**. (SPIKE Prime 3.x; NOT the LWP `00001623…` UUIDs.)
- Enable notifications on **TX**. Write to **RX**, split into ≤`maxPacketSize` byte writes
  (default 20; raise after InfoResponse). Use write-without-response where available.

## 2. Frame format (every message both directions)

```
frame = 0x01 , XOR03( COBS(payload) ) , 0x02
```
- `0x01` = frame start (optional on receive — skip if present), `0x02` = frame end / delimiter.
- `XOR03` = XOR every COBS byte with `0x03`.
- **COBS** params: DELIMITER=0x02, NO_DELIMITER=0xFF, MAX_BLOCK_SIZE=84, COBS_CODE_OFFSET=0x02.
- On receive: accumulate notification bytes, split on `0x02`, then per frame: strip optional leading
  `0x01`, XOR03, COBS-decode → `payload`.

## 3. Message types (payload first byte = message id)

| ID | Name | Layout |
|----|------|--------|
| `0x00` | InfoRequest | `[0x00]` |
| `0x01` | InfoResponse | hub→client: firmware + maxPacketSize + maxChunkSize |
| `0x0C` | StartFileUpload | `0x0C` + name(UTF-8)+`\0` + slot(u8) + fileCRC32(u32 LE) |
| `0x0D` | (status for 0x0C) | hub→client ack |
| `0x10` | TransferChunk | `0x10` + runningCRC32(u32 LE) + size(u16 LE) + data |
| `0x11` | (status for 0x10) | hub→client ack |
| `0x1E` | ProgramFlow | `0x1E` + stop(u8: 0=start,1=stop) + slot(u8) |
| `0x1F` | (status for 0x1E) | hub→client ack |
| `0x32` | TunnelMessage | `0x32` + size(u16 LE) + payload(UTF-8) ← carries SSP JSON |
| `0x46` | ClearSlot | `0x46` + slot(u8) |
| `0x47` | (status for 0x46) | hub→client ack |

**CRC32:** ISO-HDLC (poly `0xEDB88320`, reflected). Input **zero-padded to a 4-byte boundary** before
checksum. Running CRC across chunks: pass previous result as seed. Wire = little-endian.

## 4. Connection lifecycle (client MUST follow this order)

1. BLE connect; subscribe TX notifications.
2. Send **InfoRequest** (`0x00`); read InfoResponse → adopt `maxPacketSize`, `maxChunkSize`.
3. **Upload the hub controller program** to a slot (default 0):
   `ClearSlot` → `StartFileUpload`(name `program.py`, fileCRC) → `TransferChunk`×N (running CRC) →
   `ProgramFlow`(start). Await each status ack.
   - *Fast path:* if a stored program hash matches, skip upload and just `ProgramFlow`(start).
4. Hub program emits a **capability** JSON (TunnelMessage). Client reads `ssp_version`; if the major/minor
   is incompatible, surface a clear error and degrade gracefully.
5. Start **heartbeat**: send `{"cmd":"system.ping"}` every ≤5 s. If no `{"event":"pong"}` within 10 s,
   declare the connection lost.
6. Signal "ready" (hub connected) once capability is received.

## 5. SSP command/event envelope (inside TunnelMessage `0x32`)

- **Command (client→hub):** one JSON object + `\n`:
  `{"cmd":"<category.action>", "port":"<id>"?, "request_id":"<id>"?, ...params}`
- **Event (hub→client):** newline-delimited JSON objects:
  - `{"event":"sensor","port":...,"type":...,"value":...,"request_id":?}`
  - `{"event":"system","metric":...,"value":...}`
  - `{"event":"error","code":...,"message":...,"request_id":?}`
  - `{"event":"pong"}`
  - capability object (on program start)
- `request_id` echoes back on one-shot reads so the client can route responses.

Command vocabulary, parameters, ranges, and the full event list are defined in
`solaria-hub/spec/SSP-v0.8.md`. This contract only governs how those messages are framed and exchanged.

## 6. Conformance checklist for a new bridge
- [ ] Discovers by FD02 service; subscribes TX; writes RX in ≤maxPacketSize chunks
- [ ] COBS+XOR framing encode/decode passes the shared test vectors
- [ ] CRC32 with 4-byte padding + running seed matches reference
- [ ] Full upload sequence + status acks
- [ ] Capability handshake reads and version-checks `ssp_version`
- [ ] Heartbeat ping/pong with 10 s loss detection
- [ ] SSP JSON envelope over TunnelMessage, request_id routing

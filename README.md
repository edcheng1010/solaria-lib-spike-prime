# solaria-lib-spike-prime

Language-agnostic protocol library for the LEGO® SPIKE™ Prime BLE bridge, part of the
[Solaria](https://github.com/edcheng1010/solaria-hub) open-source robotics platform.

> **Unofficial integration.** Independent open-source project, not affiliated with, endorsed by, or
> sponsored by the LEGO Group, the Micro:bit Educational Foundation, or MIT. Trademarks belong to their
> respective owners; references are nominative. See the Solaria NOTICE for details.

## What's here

| Path | Purpose |
|------|---------|
| `spec/SSP-CLIENT-v0.8.md` | The client contract — what any bridge must implement (framing, upload, heartbeat) |
| `hub/hub_controller.py` | Canonical SPIKE Prime hub program (SSP v0.8). Single source of truth for the hub side. |
| `web/` | TypeScript SSP client (the bridge core powering the Scratch and Web frontends) |
| `java/` | *(future)* reference Java SDK, to be extracted from the App Inventor extension |
| `python/` | *(future)* `pip install solaria-spike` client |

## Clients that consume this library

- **App Inventor** (`.aix`) — shipped (currently embeds its own copy of the hub program + Java stack)
- **Scratch** (`solaria-scratch-spike-prime`) — Phase 4a, consumes `web/`
- **Web/JS, Python** — later phases

## Status

Phase 4a (Scratch via Web Bluetooth) — see [`PHASE_4A_PLAN.md`](PHASE_4A_PLAN.md). Protocol stack is being
ported from the verified Java implementation in `appinventor-lego-spike-prime-extension`.

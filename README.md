# solaria-lib-spike-prime

The shared protocol library for LEGO® SPIKE™ Prime integration in the [Solaria](https://github.com/edcheng1010/solaria-hub) open-source robotics ecosystem.

This library is the **infrastructure layer** that multiple Solaria client extensions share. It contains the canonical hub-side program, the SSP client implementation (TypeScript/Web), and the shared specification that governs how any Solaria client communicates with a SPIKE Prime hub. Client extensions (App Inventor, Scratch, and future platforms) each have their own blocks and interaction patterns; this library ensures they all speak the same protocol to the hardware.

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

- **App Inventor** (`.aix`) — ✅ Shipped. Currently embeds its own copy of the hub program and Java stack; a future Gen 2 Epic will extract the shared library properly.
- **Scratch/TurboWarp** (`solaria-scratch-spike-prime`) — ✅ Supported. Consumes `web/` (TypeScript SSP client). Works on physical SPIKE Prime hubs.
- **Web/JS, Python** — Planned in Gen 2. Will consume `web/` and a future `python/` sub-package respectively.

Each client has its own blocks and interaction model (App Inventor is stateful/component-based; Scratch is event-driven/sequential). This library ensures they all communicate with the hardware through the same SSP wire protocol, so the robot capabilities are consistent across clients.

## Status

The TypeScript/Web SSP client (`web/`) is implemented and hardware-tested via the Scratch extension. The canonical hub program (`hub/hub_controller.py`) is stable at SSP v0.8.

**Current work (Gen 2):** Extracting the shared protocol stack from the App Inventor extension into this library so all clients share a single source of truth. See the [Solaria Hub Roadmap](https://github.com/edcheng1010/solaria-hub/blob/main/ROADMAP.md) for full status.

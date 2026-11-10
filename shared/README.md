# PontoView Studio Hybrid — Phase 1: shared engine

This phase is intentionally **not** a desktop application or a LAN server yet.
It extracts the side-effect-free graphics state logic so the current hosted
workspace, a future Tauri service (Windows/macOS/Linux), and LAN remote control
can share exactly the same transition rules.

## Compatibility contract

- Public URLs, query-string tokens, Supabase RPC names, and subscriptions are unchanged.
- The existing `control.html` / `overlay.html` shells and their iframes still work.
- `control-core.html` and `overlay-core.html` load `shared/graphics-engine.js`
  before their inline scripts. Do not move those imports after the consumers.
- The legacy merge mutates its first argument, merges object properties, and
  replaces arrays. This is retained for backward compatibility.
- No new polling, Supabase client, WebSocket, SQLite write, or remote command is introduced.
- Lower Thirds and Weather renderers are not changed in this phase.

## State engine

`shared/graphics-engine.js` is a UMD module: available as
`window.PVGraphicsEngine` in browser and `require(...)` in Node.
It is pure JavaScript with no DOM, storage, runtime, or internet dependency.

- `clone` / `merge`: shared legacy normalization helpers.
- `takeState` / `outState` / `clearState`: pure transformations for the existing UI.
- `createSession(initial)`: create independent Preview and Program snapshots.
- `prepare(session, preview, expectedRevision)`: update Preview only.
- `take(session, expectedRevision)`: promote Preview to Program atomically.
- `out(session, graphicKey, expectedRevision)`: remove one Program graphic.
- `clear(session, graphicKeys, expectedRevision)`: hide the chosen Program graphics.

All session operations return new objects and increment a monotonic revision;
a stale revision throws `STATE_CONFLICT`.

**Important:** The current web workspace still controls Supabase and legacy
client-side state. The revisioned engine API is staged for the future local
controller. This change does not yet replace the existing production RPC
implementation, and it does not claim production runtime readiness.

## Planned local transport (not implemented in Phase 1)

- Desktop process: authoritative local state, SQLite persistence, and a
  loopback HTTP/WebSocket service, managed by Tauri/Rust.
- Browser Source: read-only program snapshot and revision events from loopback.
- LAN remote: separately authenticated and paired controller with explicit
  operator permissions, CSRF/origin checks, and no public default bind.
- Supabase: retained for account and entitlement verification, not per-TAKE writes.
- Offline entitlements: require server-signed licenses and a defined policy
  before an installer can be distributed.

## Validation

Run from repository root:

```sh
node --check shared/graphics-engine.js
node --test tests/graphics-engine.test.cjs
```

The same tests run in GitHub Actions on relevant PR changes. Before shipping,
also smoke-test News preview, take, out, and clear in browser; overlay source
with a valid public token; Weather integrated/standalone; and Lower Thirds.
Run memory and soak tests before calling the hybrid Desktop ready.

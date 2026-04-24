# Claude Context & Implementation Notes - Hearthwick

## Architecture
A serverless P2P browser MMO. Trystero (WebTorrent/WebRTC) for transport, Ed25519 for identity, a Pi Zero W as the Arbiter (state authority). No server-side game logic — the Arbiter only signs world state and validates rollups.

## Source Layout

| File | Purpose |
|---|---|
| `src/main.js` | Entry point — calls `start()` from `ui.js` |
| `src/store.js` | Shared mutable state singleton (`state`) and `selfId` re-export |
| `src/log.js` | `log(msg, color)` — DOM output helper |
| `src/identity.js` | `initIdentity()` — key generation/loading, `arbiterPublicKey` setup |
| `src/world-state.js` | `updateSimulation()`, `loadLocalState()`, `saveLocalState()`, `printStatus()`, `pruneStale()` |
| `src/networking.js` | `initNetworking()`, `joinInstance()`, `isProposer()`, `buildLeafData()` |
| `src/combat.js` | `startStateChannel()`, `resolveRound()` — PvP duel state channels |
| `src/commands.js` | `handleCommand(cmd)` — all slash commands |
| `src/ui.js` | `start()` — DOM wiring, autocomplete, input events, viewport handling |
| `src/rules.js` | Pure deterministic simulation (combat, world, sharding). No side effects. |
| `src/crypto.js` | Universal Ed25519 sign/verify (WebCrypto in browser, `node:crypto` on Pi) |
| `src/packer.js` | Binary serialization: move (2B), emote (1B), presence (96B), duelCommit (70B) |
| `src/iblt.js` | Invertible Bloom Lookup Table for O(diff) presence reconciliation |
| `src/constants.js` | `APP_ID`, tracker/STUN/TURN URLs, `GH_GIST_ID`, `ARBITER_URL` |
| `src/autocomplete.js` | `getSuggestions(input, context)` — pure, DOM-free autocomplete |
| `arbiter/index.js` | Pi Zero: state authority, day tick, rollup validation, fraud/ban |

**Production build:** `npm run build` — esbuild bundles all modules into a single `dist/main.js`. The module split is dev-only.

## Key Implementation Details

### Seed-Based Determinism
- World state is `world_seed` + `day` only (Yjs is gone).
- All randomness uses `seededRNG(hashStr(...))` (mulberry32 variant). **Never use `Math.random()`.**
- Integer math only in simulation (no floats in damage/XP).

### Shared State (`src/store.js`)
All modules that need shared mutable state import `{ state }` from `./store`. The `state` object is a plain singleton — mutate its properties directly (`state.localPlayer.hp -= 5`). Do not reassign `state` itself.

`selfId` (Trystero peer ID) is re-exported from `store.js` for convenience.

### Universal Cryptography (`src/crypto.js`)
- **Browser:** `window.crypto.subtle` (WebCrypto). `verifyMessage` requires a `CryptoKey` from `importKey()`.
- **Node (Pi):** `node:crypto`. `verifyMessage` accepts a raw Base64 string or Buffer.
- Player identity: Ed25519 key pair generated on first visit, stored in `localStorage` under `hearthwick_keys_v3`.
- `ph` (8-char hex) = `(hashStr(pubKeyBase64) >>> 0).toString(16).padStart(8,'0')`. It is NOT a key — never pass it to `verifyMessage`.

### Memory Optimization (Pi Zero W)
- 512MB RAM constraint. Arbiter logic must be O(1) or O(log n) per event.
- Nightly sequential pattern: `pm2 stop arbiter` → run `llama.cpp` → `pm2 start arbiter`.

## Current Status

### Phase 4: UX — Mobile & Input (COMPLETE)
- Autocomplete engine (`src/autocomplete.js`) with `getSuggestions(input, context)`
- Suggestion chips UI (up to 4, tappable, Tab-cycles on desktop)
- `/move <dir>` autocomplete shows valid exits; tapping moves immediately
- Mobile layout: `env(safe-area-inset-bottom)`, `position: fixed` input bar
- Quick-action bar: look / attack / rest / inventory (visible on `pointer: coarse` only)
- `visualViewport` resize handler for virtual keyboard reflow

### Phase 5: The "Commissioner" (LLM) — TODO
- `llama.cpp` + RWKV7-0.4B on Pi (ARMv6 build)
- "Nightly Cron" bash script
- "The Ticker" UI element for LLM-generated narrative

### Phase 6: Anti-Cheat & Security — TODO
- Ed25519 signatures on `/move` actions
- Deterministic move validation in `getMove` handler
- Pi blacklisting and rollback logic

### Phase 7: Graphical Client — TODO
- Kontra.js renderer

## Key Gaps (not yet implemented)
- **Arbiter election** — Pi is always assumed to be the sole Arbiter. No `electArbiter` logic exists.

## Packer Layouts

Presence packet (96 bytes):
```
[0-15]  Name (UTF-8, null-padded, byte-truncated to 16)
[16]    Location (index into ROOM_MAP)
[17-20] PH (4 bytes from 8-char hex)
[21]    Level (Uint8)
[22-25] XP (Uint32BE)
[26-31] TS (48-bit: Uint16BE high word at 26, Uint32BE low word at 28)
[32-95] Signature (64 bytes, Ed25519)
```

DuelCommit packet (70 bytes):
```
[0]    Round (Uint8)
[1]    Damage (Uint8)
[2-5]  Day (Uint32BE)
[6-69] Signature (64 bytes)
```

All multi-byte DataView fields are big-endian. Always pass `false` explicitly.

## Fraud Proof Format

```js
// witness.presence must include disputedRoot to prevent replay attacks
{
  rollup: { rollup, signature, publicKey },
  witness: {
    id: selfId,
    presence: { name, location, ph, level, xp, ts, disputedRoot: rollup.root },
    signature: string,   // Ed25519 sig over JSON.stringify(presence)
    publicKey: string,   // Base64 public key of the witness
  }
}
```

Arbiter checks `presence.disputedRoot === rollup.root` before accumulating the report.

## Proposer Election

```js
const all = Array.from(players.keys()).concat(selfId).sort();
const slot = Math.floor(Date.now() / ROLLUP_INTERVAL) % all.length;
// Primary: all[slot] === selfId
// Fallback: if lastRollupReceivedAt > 1.5× interval, all[(slot+1) % all.length] === selfId
```

- Don't propose if alone (`all.length < 2`) — prevents Arbiter spam.
- `createMerkleRoot` is **lazy-imported** inside the rollup interval. Don't move it to top-level imports.
- `buildLeafData()` in `networking.js` filters `selfId` from `players` before pushing self explicitly — prevents double-leaf fraud false-positives.

## Arbiter Notes

- Day tick: `scheduleTick()` (recursive `setTimeout` targeting `last_tick + 86400000`). On restart it loops to catch up all missed days before scheduling the next real tick.
- Rate limiting: one rollup per public key per `ROLLUP_INTERVAL * 0.8` ms (`lastRollupTime` map).
- Ban persistence: `worldState.bans = Array.from(bans)` written before every `schedulePersist()`.
- Peer join: sends state only to the new peer (`sendState(packet, [peerId])`), not a full broadcast.
- Maps `lastRollupTime` and `fraudCounts` are purged hourly to prevent unbounded growth on Pi Zero.
- `doReset()` clears `fraudCounts` and `lastRollupTime`.

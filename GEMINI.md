# Gemini CLI Project Mandates - Hearthwick (Micro-MMO)

## Project Vision
A **micro cosy metaverse** — a living, persistent fantasy world (Stardew Valley meets L.O.R.D.) with Blaseball-style community storytelling. $0/month infrastructure goal.

## Core Mandates (NON-NEGOTIABLE)
- **Bundle Size:** Current: ~121KB post-refactor. Hard limit: **< 175KB**. Check `dist/main.js` after every build.
- **Determinism:** All randomness uses `mulberry32` via `seededRNG(hashStr(...))`. **Never use `Math.random()`.**
- **Math:** **Integer math only** in simulation logic (no floats in damage/XP calculations).
- **Memory:** Pi Zero W constraint (512MB RAM). Keep arbiter logic O(1) or O(log n) per event.
- **Dependencies:** Do not add npm packages. `@trystero-p2p/torrent` is the only transport.
- **Tests:** Run `npm test` before finishing any task. All **226 tests must pass**. Do not submit if any fail.

---

## Current Architecture (v0.7.0 — Modular Source)

**Yjs has been completely removed.** **Nostr has been removed.**

### State Model
- **Global state** (day, seed, mood, season): Signed JSON broadcast by the Arbiter. Clients verify the Ed25519 signature against `MASTER_PUBLIC_KEY` before accepting.
- **Player state**: Ephemeral. Gossipped as binary `Uint8Array` (see `packer.js`) over Trystero data channels.
- **Persistence**: `localStorage` under key `hearthwick_state_v5`.
- **Shared mutable state**: All modules import `{ state }` from `./store`. Mutate `state.*` properties in-place; do not reassign `state` itself.

### Transport Layer & Discovery
- **Transport**: `@trystero-p2p/torrent` only.
- **Fast-Path Discovery**: Client races these beacons:
    - **GitHub Gist**: Signed discovery JSON fetched via CDN (~500ms).
    - **HTTP Fallback**: Direct `/state` fetch if `ARBITER_URL` is configured.
- **Instance sharding**: Players join rooms named `getShardName(location, instanceId)` → `${location}-${instanceId}`. Instance cap: 50 players.
- **Global room**: A separate `'global'` room for Arbiter↔client state, rollup, and fraud messages.

### Source Layout
| File | Purpose |
|---|---|
| `src/main.js` | Entry point — calls `start()` |
| `src/store.js` | Shared mutable state singleton (`state`) + `selfId` re-export |
| `src/log.js` | `log(msg, color)` DOM helper |
| `src/identity.js` | `initIdentity()` |
| `src/world-state.js` | `updateSimulation()`, `loadLocalState()`, `saveLocalState()`, `printStatus()`, `pruneStale()` |
| `src/networking.js` | `initNetworking()`, `joinInstance()`, `isProposer()`, `buildLeafData()` |
| `src/combat.js` | `startStateChannel()`, `resolveRound()` |
| `src/commands.js` | `handleCommand(cmd)` |
| `src/ui.js` | `start()` — DOM wiring, autocomplete, input, viewport |
| `src/rules.js` | Pure deterministic simulation |
| `src/crypto.js` | Universal Ed25519 (WebCrypto / node:crypto) |
| `src/packer.js` | Binary serialization |
| `src/iblt.js` | IBLT set reconciliation |
| `src/constants.js` | URLs, keys, config |
| `src/autocomplete.js` | `getSuggestions(input, context)` — pure, testable |
| `arbiter/index.js` | Pi Zero arbiter |

**Production:** `npm run build` bundles everything via esbuild into a single `dist/main.js`. The module split is dev-only.

---

## Critical Contracts — Read Before Touching These Files

### `src/store.js`

All shared mutable state lives here as a plain `state` object. Access via `state.localPlayer`, `state.worldState`, `state.players`, etc. `selfId` is re-exported here for convenience.

Do **not** destructure `let { localPlayer } = state` at module scope — this breaks reactivity. Always write `state.localPlayer`.

### `src/crypto.js`

`verifyMessage(message, signatureBase64, publicKey)`:
- **Browser**: `publicKey` must be a `CryptoKey` returned by `importKey(b64, 'public')`.
- **Node**: `publicKey` can be a raw Base64 string (32-byte Ed25519) or `Buffer`.
- **Never** pass `ph` (8-char hex hash) — it will throw or silently fail.

`importKey(base64, type)`:
- Returns a `CryptoKey` in browser, raw `Buffer` in Node.
- Pattern: `const pubKey = await importKey(b64, 'public'); await verifyMessage(msg, sig, pubKey);`

### `src/packer.js`

Presence packet (96 bytes):
```
[0-15]  Name (UTF-8, byte-truncated to 16)
[16]    Location (ROOM_MAP index)
[17-20] PH (4 bytes from 8-char hex)
[21]    Level (Uint8)
[22-25] XP (Uint32BE)
[26-27] TS high (Uint16BE)
[28-31] TS low (Uint32BE)
[32-95] Signature (64 bytes)
```

DuelCommit packet (70 bytes):
```
[0]    Round (Uint8)
[1]    Damage (Uint8)
[2-5]  Day (Uint32BE)
[6-69] Signature (64 bytes)
```

**Endianness**: Always pass `false` to `setUint32`/`getUint32` (big-endian). Always construct `DataView` with `(buf.buffer, buf.byteOffset, buf.byteLength)`.

### `src/iblt.js`

- `IBLT.hashId(id: string): BigInt` — use this static method.
- `decode()` is **destructive** — do not call twice on the same instance.
- `decode()` returns `{ added: BigInt[], removed: BigInt[], success: boolean }`.

### `src/rules.js`

- `getShardName(location, instanceId): string` — **2 args, no appId**. Swarm isolation is handled by `appId` in the Trystero config.
- `resolveAttack(atk, def, rng)` — use actual opponent `.defense` stat, not `DEFAULT_PLAYER_STATS.defense`.

---

## Presence Actions (Two Separate Trystero Actions)

- `presence_single` — binary `Uint8Array` (packed via `packPresence`). Heartbeats and peer-join responses.
- `presence_batch` — JSON `{ [peerId]: { presence: Uint8Array, publicKey: string } }`. IBLT reconciliation only.

---

## Proposer Election

```js
const all = Array.from(state.players.keys()).concat(selfId).sort();
if (all.length < 2) return false; // Don't propose alone
const slot = Math.floor(Date.now() / ROLLUP_INTERVAL) % all.length;
// Primary: all[slot] === selfId
// Fallback: lastRollupReceivedAt stale → all[(slot+1) % all.length] === selfId
```

`createMerkleRoot` is **lazy-imported** inside the rollup interval. Do not move to top-level.

`buildLeafData()` filters `selfId` from `state.players` before pushing self — prevents double-leaf.

---

## Fraud Proof Format

```js
{
  rollup: { rollup, signature, publicKey },
  witness: {
    id: selfId,
    presence: { name, location, ph, level, xp, ts, disputedRoot: rollup.root },
    signature: string,
    publicKey: string,
  }
}
```

Arbiter checks `presence.disputedRoot === rollup.root` before accumulating. Prevents replay of old witness signatures.

---

## Arbiter (`arbiter/index.js`)

- **Ban persistence**: `worldState.bans = Array.from(bans)` before every `schedulePersist()`.
- **Rate limiting**: `lastRollupTime` map, one rollup per key per `ROLLUP_INTERVAL * 0.8` ms.
- **Day tick**: `scheduleTick()` — recursive `setTimeout` on `last_tick + 86400000`. Loops to catch up missed days on restart.
- **Peer join**: sends state only to new peer, not broadcast to all.
- **Cleanup**: hourly purge of `lastRollupTime` / `fraudCounts` to prevent unbounded growth.
- **Health endpoint**: `http://127.0.0.1:3001/health`.

---

## Common Mistakes — Do Not Repeat These

1. **`getShardName` takes 2 args** — `(location, instanceId)`. No `appId` prefix. Trystero's `appId` config handles swarm isolation.

2. **`ph` is not a key** — `ph` is `(hashStr(pubKey) >>> 0).toString(16).padStart(8,'0')`. Never pass to `verifyMessage`.

3. **Raw Base64 to `verifyMessage` in browser** — always `importKey` first: `const key = await importKey(b64, 'public'); verifyMessage(msg, sig, key)`.

4. **`new IBLT()._hashKey(id)`** — use `IBLT.hashId(id)` instead.

5. **DataView endianness** — always pass `false` (big-endian). Always include `byteOffset`/`byteLength`.

6. **Old proposer logic** — do not write `selfId < all[0]`. Use the time-slot formula.

7. **O(n) fraud witness** — one signed presence is the full proof.

8. **`setInterval` for day tick** — use `scheduleTick()` (recursive `setTimeout`).

9. **Bans not persisted** — always set `worldState.bans = Array.from(bans)` and call `schedulePersist()`.

10. **`createMerkleRoot` at top-level** — keep as lazy `await import('./crypto')` inside the rollup interval.

11. **Redundant room name prefix** — do not prefix room names with `APP_ID`. Use `'global'` for global room and `getShardName(loc, inst)` for shards.

12. **Destructuring `state` at module scope** — always access via `state.localPlayer`, never `let { localPlayer } = state`.

---

## When You Are Stuck — Loop Prevention Protocol

If an approach has failed **twice**, stop and follow this exactly:

1. Run `npm run diagnose` — read the full output before touching any file.
2. Quote the failing test name, exact error message, and file/line.
3. Re-read the relevant source file from scratch (not from memory).
4. Check `DECISIONS.md` if the fix touches transport, state, crypto, proposer, or fraud proof.
5. Make one targeted change, run `npm test` immediately.

If still failing: **stop**. Say: *"I've attempted this twice. Here is what the error says: [quote]. Here is what I tried: [describe]. I need guidance."*

---

## Verification — Run Before Finishing Any Task

```bash
npm run verify
```

Runs all 226 tests, builds the bundle, checks imports, scans for forbidden patterns.

Manual checklist:
- [ ] All `verifyMessage` browser calls use `importKey`-returned `CryptoKey`
- [ ] No new npm dependencies
- [ ] `DECISIONS.md` consulted if touching ADR topics
- [ ] `state.*` accessed via `state` object, not destructured at module scope

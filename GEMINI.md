# Gemini CLI Project Mandates - Hearthwick (Micro-MMO)

## Project Vision
A **micro cosy metaverse** — a living, persistent fantasy world (Stardew Valley meets L.O.R.D.) with Blaseball-style community storytelling. $0/month infrastructure goal.

## Core Mandates (NON-NEGOTIABLE)
- **Bundle Size:** Current: ~121KB post-refactor. Hard limit: **< 175KB**. Check `dist/main.js` after every build.
- **Determinism:** All randomness uses `mulberry32` via `seededRNG(hashStr(...))`. **Never use `Math.random()`.**
- **Math:** **Integer math only** in simulation logic (no floats in damage/XP calculations).
- **Memory:** Pi Zero W constraint (512MB RAM). Keep arbiter logic O(1) or O(log n) per event.
- **Dependencies:** Do not add npm packages. Trystero (torrent) is the only transport.
- **Tests:** Run `npm test` before finishing any task. All **171 tests must pass**. Do not submit if any fail.

---

## Current Architecture (v0.6.0 — Scaling Refactor COMPLETE)

**Yjs has been completely removed.** The old CRDT-based architecture is gone. Do not reference it.

### State Model
- **Global state** (day, seed, mood, season): Signed JSON broadcast by the Arbiter. Clients verify the Ed25519 signature against `MASTER_PUBLIC_KEY` before accepting.
- **Player state**: Ephemeral. Gossipped as binary `Uint8Array` (see `packer.js`) over Trystero data channels.
- **Persistence**: `localStorage` under key `hearthwick_state_v5`.

### Transport Layer
- **Transport**: `@trystero-p2p/torrent` only. Nostr has been removed due to relay instability and bundle size.
- **Instance sharding**: Players join dynamic rooms named `getShardName(APP_ID, location, instanceId)` (e.g. `hearthwick-tavern-2`). Instance cap: 50 players.
- **Global room**: A separate `'global'` room used only for Arbiter↔client state and rollup/fraud messages.

### Key Files
| File | Purpose |
|---|---|
| `src/main.js` | Client entry: identity, networking, game loop, command handler |
| `src/rules.js` | Pure deterministic simulation (combat, world, sharding) |
| `src/crypto.js` | Universal Ed25519 sign/verify for browser (WebCrypto) and Node |
| `src/packer.js` | Binary serialization: move (2B), emote (1B), presence (96B), duelCommit (70B) |
| `src/iblt.js` | IBLT for O(diff) presence reconciliation |
| `src/constants.js` | APP_ID, relay/tracker URLs, ICE servers |
| `arbiter/index.js` | Pi Zero: state authority, rollup validation, fraud banning, health endpoint |

---

## Critical Contracts — Read Before Touching These Files

### `src/crypto.js`

`verifyMessage(message, signatureBase64, publicKey)`:
- **Browser**: `publicKey` must be a `CryptoKey` object returned by `importKey(b64, 'public')`.
- **Node**: `publicKey` can be a raw Base64 string (32-byte Ed25519 public key) OR a `Buffer`.
- **Never** pass `ph` (the 8-char hex hash), a peer ID, or any other string. It will throw or silently fail.

`importKey(base64, type)`:
- Returns a `CryptoKey` in browser, a raw `Buffer` in Node.
- Always call `importKey` before passing a key to `verifyMessage` in browser code.
- Pattern: `const pubKey = await importKey(b64, 'public'); await verifyMessage(msg, sig, pubKey);`

`signMessage(message, privateKey)`:
- **Node**: accepts raw Base64 string (seed) or Buffer. Handles PKCS8 wrapping internally.
- Returns a Base64 string.

### `src/packer.js`

Presence packet layout (96 bytes):
```
[0-15]  Name (UTF-8, null-padded, 16 bytes max)
[16]    Location (index into ROOM_MAP)
[17-20] PH (4 bytes decoded from 8-char hex)
[21]    Level (Uint8)
[22-25] XP (Uint32, big-endian — always pass false to DataView methods)
[26-27] Timestamp high word (Uint16BE)
[28-31] Timestamp low word (Uint32BE)
[32-95] Signature (64 bytes)
```

DuelCommit packet layout (70 bytes, **not 77**):
```
[0]    Round (Uint8)
[1]    Damage (Uint8)
[2-5]  Day (Uint32BE)
[6-69] Signature (64 bytes)
```

**Endianness**: All multi-byte DataView fields use big-endian. Always pass `false` explicitly: `view.setUint32(offset, value, false)`.

### `src/iblt.js`

- `IBLT.hashId(id: string): BigInt` — static method, use this instead of `new IBLT()._hashKey(id)`.
- `decode()` returns `{ added: BigInt[], removed: BigInt[], success: boolean }`. All IDs are BigInts (hashed), not raw strings.
- When filtering local players against a request list: `ids.some(x => x === IBLT.hashId(localId))`.

### `src/rules.js`

- `getShardName(appId, location, instanceId): string` — **must be imported** wherever used.
- `INSTANCE_CAP = 50` — **must be imported** wherever used.
- `resolveAttack(atk, def, rng)` — use the opponent's actual `.defense` stat, not `DEFAULT_PLAYER_STATS.defense`.

---

## Presence Actions (Two Separate Trystero Actions)

There are **two** presence actions — do not merge them:
- `presence_single` — binary `Uint8Array` (packed via `packPresence`). Used for heartbeats and peer-join responses.
- `presence_batch` — JSON `{ [peerId]: { presence: Uint8Array, publicKey: string } }`. Used for IBLT reconciliation responses only.

---

## Proposer Election

The elected Proposer computes Merkle rollups. Election is time-slotted:
```js
const all = Array.from(players.keys()).concat(selfId).sort();
const slot = Math.floor(Date.now() / ROLLUP_INTERVAL) % all.length;
// Primary: all[slot] === selfId
// Fallback: if lastRollupReceivedAt is stale (> 1.5× interval), all[(slot+1) % all.length] === selfId
```
Do **not** use `selfId < all[0]` (old, broken logic — every peer independently sees the same slot).

`createMerkleRoot` is **lazy-imported** inside the rollup interval: `const { createMerkleRoot } = await import('./crypto')`. Do not move it to the top-level import.

---

## Fraud Proof Format (O(1) Witness)

```js
// Client emits:
{
  rollup: { rollup, signature, publicKey },  // the disputed rollup data
  witness: {
    id: string,           // selfId of the reporter
    presence: object,     // { name, location, ph, level, xp, ts }
    signature: string,    // reporter's Ed25519 sig of their own presence
    publicKey: string,    // reporter's Base64 public key
  }
}
```

**witness is a plain object, not an array.** The Arbiter accumulates reports from distinct claimants and bans the Proposer after `FRAUD_BAN_THRESHOLD = 3` unique reporters.

---

## Arbiter (`arbiter/index.js`)

- **Ban persistence**: `bans` is initialized from `worldState.bans` on startup, and `worldState.bans = Array.from(bans)` is written before every `schedulePersist()` call.
- **Rate limiting**: One rollup per public key per `ROLLUP_INTERVAL * 0.8` ms. Check `lastRollupTime` map before processing.
- **Day tick**: Uses `scheduleTick()` (recursive `setTimeout`) anchored to `worldState.last_tick`, not `setInterval`. This prevents drift across restarts.
- **Health endpoint**: `http://127.0.0.1:3001/health` — returns `{ day, seed, bans, uptime }`.
- **`signMessage` call**: Pass `MASTER_SECRET_KEY` (raw Base64 string from `.env`) directly — the Node path handles string keys internally.

---

## Common Mistakes — Do Not Repeat These

1. **Missing imports from `rules.js`**: `getShardName` and `INSTANCE_CAP` are used in `main.js` — they must be in the import list. Check the import block before submitting.

2. **Passing `ph` to `verifyMessage`**: `ph` is `(hashStr(pubKey) >>> 0).toString(16)` — an 8-char hex hash of the public key. It is NOT a key. Always use the stored `publicKey` field (Base64) and call `importKey` first in browser code.

3. **Raw Base64 string to `verifyMessage` in browser**: The browser path (`window.crypto.subtle.verify`) requires a `CryptoKey`, not a string. Always: `const key = await importKey(b64, 'public'); verifyMessage(msg, sig, key)`.

4. **`new IBLT()._hashKey(id)` for a pure hash**: Use `IBLT.hashId(id)` instead.

5. **DataView endianness**: Always pass `false` (big-endian) to `setUint32` / `getUint32`. Default is big-endian in DataView, but be explicit.

6. **Old proposer logic**: Do not write `selfId < all[0]`. Use the time-slot formula above.

7. **O(n) fraud witness**: Do not send all players as witnesses. One signed presence packet is the full proof.

8. **`setInterval` for day tick**: Use `scheduleTick()` (recursive `setTimeout` targeting `last_tick + 86400000`).

9. **Bans not persisted**: When adding a ban, always set `worldState.bans = Array.from(bans)` and call `schedulePersist()`.

10. **`createMerkleRoot` at top-level import**: Keep it as a lazy `await import('./crypto')` inside the rollup interval. Non-proposers should not load it eagerly.

---

## When You Are Stuck — Loop Prevention Protocol

If an approach has failed **twice**, stop and follow this protocol exactly. Do not try a third variation.

### Step 1: Read the actual error
```bash
npm run diagnose
```
This shows the failing test name, the exact line, and the surrounding source. Read it fully before doing anything else. Do not skim.

### Step 2: Quote the failure before touching any file
Write out:
- Which test is failing (exact name)
- What the error message says
- Which file and line it points to

If you cannot answer all three, you do not yet understand the problem. Re-read the output.

### Step 3: Read the file you are about to edit — from scratch
Do not rely on memory from earlier in the session. Re-read the relevant source file in full. The bug is usually in a different place than you expect.

### Step 4: Check DECISIONS.md
If your fix involves changing an architectural pattern (transport, state model, crypto, proposer, fraud proof), check `DECISIONS.md` first. The approach you are trying may have already been tried and rejected.

### Step 5: Make one targeted change
Fix the specific thing the error points to. Do not refactor surrounding code. Do not fix unrelated things. Run `npm test` immediately after.

### If still failing after Step 5
Stop. Do not loop. Say: *"I've attempted this twice. Here is what the error says: [quote]. Here is what I tried: [describe]. I need guidance."*

---

## Project Reference Files

| File | Purpose |
|---|---|
| `GEMINI.md` | This file — project mandates and contracts |
| `DECISIONS.md` | Architecture Decision Records — read before changing any major pattern |
| `scripts/verify.sh` | Pre-submit verification script — **run this last** |

---

## Verification — Run Before Finishing Any Task

```bash
npm run verify
```

This runs all 171 tests, builds the bundle, checks imports, and scans for forbidden patterns. **Do not submit if it fails.**

Manual checklist:
- [ ] Every `verifyMessage` call in browser code passes an `importKey`-returned `CryptoKey`, not a raw string
- [ ] No new npm dependencies added (`package.json` unchanged)
- [ ] Read `DECISIONS.md` — if your change touches an ADR topic, follow the decision or ask first

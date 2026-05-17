# Networking Audit — 2026-05-17

## Scope

This audit covered the full client networking path and adjacent code that affects peer convergence:

- `src/network/*`
- `src/main/bootstrap.js`
- `src/main/snapshot.js`
- `src/e2e-entry.js`
- `src/state/store.js`
- `src/systems/network-system.js`
- `src/systems/world-sync-system.js`
- `arbiter/index.js`
- `scripts/browser-two-peer.mjs`
- `scripts/browser-two-peer-live.mjs`

Primary acceptance bar:

- Two peers in the same room should become visible to each other within **3 seconds** under normal two-peer conditions.

## Current Measured Behavior

### Fake transport (`npm run test:browser`)

- Same-room discovery: **5 ms**
- Name propagation: **3 ms**
- Move propagation: **2 ms**

Interpretation:

- Once peers are connected and the room/action plumbing is active, the signed presence path, player store updates, and ECS/render projection are effectively immediate.
- The same-room UX problem is **not** in `trackPlayer`, `WorldSyncSystem`, or UI refresh on the deterministic/fake path.

### Live transport (`npm run test:browser:live`)

- Same-room discovery: **17,251 ms**
- Name propagation after discovery: **18 ms**
- Budget result: **fails 3 s bar badly**

Critical observation from the live timeline:

- Both peers broadcast initial shard presence at boot.
- The first `global:peer_join` / `shard:peer_join` milestone does not happen until ~17 seconds later.
- After join, `peer:presence_verified` lands within a few milliseconds.

Interpretation:

- The slowness is overwhelmingly in **real transport discovery / connection establishment before peer join**, not in post-join presence verification.

## End-to-End Path

The current normal path for two peers in one room is:

1. `bootstrap:start`
2. local state load + identity generation
3. `initNetworking()`
4. join global room
5. join shard room for current location
6. broadcast initial identity + signed presence on shard
7. wait for Trystero/WebRTC peer join
8. exchange identity / presence bootstrap
9. verify signed presence and write live peer into `players`
10. `WorldSyncSystem` projects the peer into ECS for render

Repair/fallback paths that also exist:

- global presence bootstrap
- Minisketch sketch/request reconciliation
- presence delta requests
- shard heal / reconnect
- arbiter HTTP peer snapshot ghosts
- cached shard introducers

## Prioritized Findings

### 1. Real same-room delay is upstream of presence verification

Evidence:

- Fake transport is instant.
- Live transport takes ~17.2 seconds before the first peer join.
- Once join occurs, signed presence verification and visibility happen almost immediately.

Meaning:

- The problem is in real discovery / room connectivity, not in the local sync/render half of the pipeline.

Likely owners:

- `src/network/transport.js`
- Trystero room join behavior
- global/shard room bootstrap sequencing in `src/network/index.js`

### 2. Same-room “normal path” still depends on cold tracker/DHT discovery

Current behavior:

- Both peers join shard at boot and immediately broadcast presence.
- That broadcast does not help until a real peer connection already exists.
- First-contact convergence still waits on the transport layer to produce a shard peer join.

Meaning:

- The system has strong repair paths after connection, but no sufficiently strong fast path for **cold first contact** between two peers who are already in the same room.

Design consequence:

- Presence is “instant after connect,” but connect itself is not optimized enough to meet the product bar.

### 3. Global room is not accelerating first same-room visibility enough

Observed behavior:

- In the live run, global and shard peer joins appear together at the late point.
- That suggests the global room is not materially shortening the cold-start path to shard convergence for a two-peer case.

Meaning:

- The global room currently behaves more like eventual discovery scaffolding than a true fast introducer for same-room peers.

Likely causes to inspect next:

- whether the global room sees peers too late
- whether `seeking_shard` is sent too early to matter
- whether shard bootstrap is waiting on the same underlying transport readiness anyway

### 4. Pre-join and cached introducers help revisits, not first contact

Current behavior:

- `preJoinShard()` opens a future shard room early.
- cached introducers seed passive view on later joins.

Risk:

- These help room transitions and repeat visits, but they do not solve the cold same-room case where two peers have never seen each other before.

### 5. `src/network/index.js` is still too monolithic for regression isolation

Current shape:

- global discovery
- shard join
- bootstrap
- presence verification
- Minisketch
- heal/reconnect
- rollups
- trade/duel/action log handling

all live in one file.

Meaning:

- It is too easy for a resilience fix, anti-ghost patch, or heal tweak to alter normal-path latency without that being obvious in review.

This is an auditability problem and likely part of why regressions have been hard to pin down phase-to-phase.

### 6. Existing browser harnesses had drift that masked networking truth

Found during audit:

- E2E test global name drift: `__HEARTHWICK_TEST__` vs `__FENHOLLOW_TEST__`
- stale movement assertion assumed fixed spawn coordinates
- same-room timing was not surfaced as a first-class metric

Meaning:

- The repo had networking tests, but they were not measuring the user-facing complaint directly enough.

## Code Areas That Look Healthy

These are not the primary cause of the reported slowness based on current evidence:

- signed presence packing / verification after join
- player store merge path
- same-room projection into ECS/render
- name propagation after discovery
- move propagation after discovery

## Highest-Value Next Fixes

### 1. Make same-room convergence measurable in CI/debug

- Keep the new audit timeline and browser timing output.
- Treat live same-room discovery time as a tracked metric, not just pass/fail folklore.

### 2. Strengthen first-contact fast path

Candidates:

- make global discovery produce shard-targeted introductions earlier
- send shard bootstrap/identity over the earliest available path rather than waiting for full shard peer stabilization
- evaluate whether a direct global-to-shard introducer exchange can shorten the first real shard join

### 3. Separate normal path from repair path in code

- carve `src/network/index.js` into clearer modules:
  global discovery, shard bootstrap, presence sync, heal/reconnect, and peer actions
- this is not cosmetic; it reduces the chance that resilience patches slow the hot path silently

### 4. Add a dedicated room-transition networking audit

- The hallway pre-join path dropped to zero usable shard peers in the earlier extended fake harness run.
- That is a separate networking risk from cold same-room discovery and should be audited independently.

## Audit Conclusion

The networking is **not uniformly broken**.

What is true:

- The deterministic/fake path is fast.
- The signed presence / render path after connection is fast.
- The real cold-start peer discovery path is far too slow for the intended UX.

So the current product problem is:

- **real transport discovery and room connectivity are too slow**
- **same-room sync feels bad because the system becomes fast only after the peers finally connect**

That is consistent with the user report that “a few phases ago it felt good” and now two peers can wait far too long to sync in the same room.

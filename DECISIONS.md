# Architecture Decision Records — Hearthwick

These decisions are final. Do not relitigate them without explicit instruction.

---

## ADR-001: Yjs removed — global state is Arbiter-signed JSON

**Status:** Decided (v0.6.0)
**Do not:** Re-introduce Yjs, Y.Map, Y.Array, or any CRDT library.

**Why:** Yjs tombstones grow unboundedly. At ~800 CCU, the Pi Zero exhausted its 512MB RAM and browser main threads stalled. The CRDT conflict-resolution model is also unnecessary here — global state has a single author (the Arbiter), so there are no conflicts to resolve.

**Replacement:** Arbiter signs a JSON state object with Ed25519. Clients verify and apply. No merge logic needed.

---

## ADR-002: Browser client uses torrent-only transport; arbiter keeps both

**Status:** Decided (updated v0.7.0 — nostr dropped from browser)
**Do not:** Re-add `@trystero-p2p/nostr` to `src/main.js`.

**Why:** `@trystero-p2p/nostr` pulls in `@noble/secp256k1` (~54KB source), which dominated the bundle. Torrent DHT peer discovery is sufficient and more reliable than nostr relays (which are centralized and can rate-limit). Dropping nostr reduced the gzipped bundle from ~30KB to ~25KB. The arbiter (`arbiter/index.js`) retains both transports since bundle size is irrelevant there and the redundancy helps the Pi stay reachable.

---

## ADR-003: createMerkleRoot is lazy-imported

**Status:** Decided
**Do not:** Move `createMerkleRoot` to the top-level import in `main.js`.

**Why:** Bundle size. Only the elected Proposer (typically one peer per instance) ever calls this function. Eager-importing it adds ~2KB and forces all non-proposer clients to parse it. The dynamic `await import('./crypto')` inside the rollup interval is intentional.

---

## ADR-004: Instance sharding via Trystero dynamic room IDs

**Status:** Decided
**Do not:** Introduce js-libp2p, GossipSub, or any new P2P library.

**Why:** Adding js-libp2p would exceed the 175KB bundle limit by ~3×. Trystero already provides WebRTC negotiation. Changing the room name (`hearthwick-tavern-2`) achieves the same isolation as a separate pub-sub topic at zero additional dependency cost.

---

## ADR-005: Proposer election uses time-slot rotation

**Status:** Decided (replaces old `selfId < all[0]` scheme)
**Do not:** Use `selfId < all[0]` or any permanent-lowest-ID scheme.

**Why:** The lowest-ID scheme permanently elects one peer. If that peer disconnects, no rollups are submitted until the next peer-join event, which could be minutes. The time-slot scheme (`floor(now / ROLLUP_INTERVAL) % peerCount`) distributes load and has a built-in fallback: if the elected peer misses 1.5× the interval, the next peer in sorted order steps up.

---

## ADR-006: Fraud proofs use a single O(1) witness

**Status:** Decided
**Do not:** Send all players as witnesses (old O(n) format).

**Why:** The old format sent the entire room's player list as the fraud proof, which is O(n) bytes and requires the Pi Zero to re-verify every player's signature. The new format sends only the reporter's own signed presence. The Arbiter accumulates reports from distinct claimants and bans at a threshold (3), preventing a single rogue client from framing an honest Proposer.

---

## ADR-007: Day tick uses recursive setTimeout, not setInterval

**Status:** Decided
**Do not:** Replace `scheduleTick()` with `setInterval(advanceDay, 86400000)`.

**Why:** `setInterval` drifts — JS timers fire late, and the drift accumulates across restarts. If the Arbiter restarts 6 hours into a day, `setInterval` would tick again after a full 24 hours (30 hours total). `scheduleTick` anchors to `worldState.last_tick`, so restarts don't add extra time.

---

## ADR-008: Math.random() is banned

**Status:** Non-negotiable
**Do not:** Use `Math.random()` anywhere in simulation, arbiter, or rules logic.

**Why:** Determinism. The entire simulation must be reproducible from `world_seed + event_log`. `Math.random()` produces different values on every peer and every run, breaking consensus.

**Use instead:** `seededRNG(hashStr(seed_string))`.

---

## ADR-009: No new npm dependencies

**Status:** Non-negotiable
**Do not:** Run `npm install <anything>` without explicit approval.

**Why:** Bundle size limit is 175KB. Every new dependency risks exceeding it. Trystero (nostr + torrent), esbuild, and jest are the full dependency set by design.

---

## ADR-010: Binary packer uses big-endian for all multi-byte fields

**Status:** Decided
**Do not:** Mix endianness or omit the `false` argument to DataView methods.

**Why:** Consistency. All `setUint32` / `getUint32` calls explicitly pass `false` (big-endian). Omitting this flag relies on the DataView default (which is big-endian), but implicit defaults have caused bugs. Always be explicit.

# Architecture Decision Records — Hearthwick

These decisions are final. Do not relitigate them without explicit instruction.

---

## ADR-001: Yjs removed — global state is Arbiter-signed JSON

**Status:** Decided (v0.6.0)
**Do not:** Re-introduce Yjs, Y.Map, Y.Array, or any CRDT library.

**Why:** Yjs tombstones grow unboundedly. At ~800 CCU, the Pi Zero exhausted its 512MB RAM and browser main threads stalled. The CRDT conflict-resolution model is also unnecessary here — global state has a single author (the Arbiter), so there are no conflicts to resolve.

**Replacement:** Arbiter signs a JSON state object with Ed25519. Clients verify and apply. No merge logic needed.

---

## ADR-002: Nostr dropped — torrent-only transport

**Status:** Decided (v0.7.0)
**Do not:** Re-add `@trystero-p2p/nostr` to `src/main.js` or `arbiter/index.js`.

**Why:** Nostr relays proved unreliable, frequently rate-limiting the Arbiter and causing connection noise. Additionally, `@trystero-p2p/nostr` pulls in `@noble/secp256k1` (~54KB source), which dominated the client bundle. BitTorrent tracker discovery is sufficient, more resilient, and keeps the bundle small (~25KB gzipped). Both client and Arbiter now use only the torrent transport.

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

**Why:** Bundle size limit is 250KB (raised from 175KB in Phase 8.2 to accommodate procedural tile art and shape data). Every new dependency risks exceeding it. Trystero (nostr + torrent), esbuild, and jest are the full dependency set by design.

---

## ADR-010: Binary packer uses big-endian for all multi-byte fields

**Status:** Decided
**Do not:** Mix endianness or omit the `false` argument to DataView methods.

**Why:** Consistency. All `setUint32` / `getUint32` calls explicitly pass `false` (big-endian). Omitting this flag relies on the DataView default (which is big-endian), but implicit defaults have caused bugs. Always be explicit.

---

## ADR-011: Scenery labels are string keys, not emoji characters

**Status:** Decided (Phase 8.2)
**Do not:** Use emoji characters as scenery labels in rooms.js or scatter definitions.

**Why:** Emojis are platform-dependent (render differently per OS), cannot be reliably matched in string comparisons across environments, and fall back to Canvas `fillText` rendering which bypasses the procedural sprite system. All scenery is now identified by a string key (`'tree'`, `'rock'`, `'crate'`, etc.) that maps directly to a SHAPES entry in `graphics.js`.

---

## ADR-012: Room data format stays as pipe-delimited DSL

**Status:** Decided (Phase 8.2)
**Do not:** Migrate room definitions to JSON, TOML, or any external format file.

**Why:** Evaluated Tiled (TMX/TMJ), LDtk, Ogmo, RON, and TOML. All require either a parser library (violates ADR-009), have no JS implementation, or produce files too verbose for the bundle constraints. The current pipe-delimited strings in `defineRoom()` are already ~50% more compact than equivalent JSON and parse with a one-liner split. Extended in Phase 8.2 with a `tiles` row-string grid format for hand-authored tile overrides.

---

## ADR-013: Edge room transitions use LttP-style full-side portals

**Status:** Decided (Phase 8.2)
**Do not:** Require players to stand on a specific tile coordinate to trigger an edge (overworld) transition.

**Why:** The previous system required exact exitTile coordinates for edge-type transitions, making room connections feel like point teleporters rather than natural overworld movement. The movement system now triggers on room boundary crossing (x < 0, x ≥ width, etc.) using `loc.exits[dir]`, and preserves the player's position offset along the crossed edge (Y preserved when going E/W, X preserved when going N/S), clamped to destination room dimensions. Door and stairs transitions remain coordinate-specific.

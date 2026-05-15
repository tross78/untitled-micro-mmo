# Architecture Decision Records — Fenhollow

These decisions are final. Do not relitigate them without explicit instruction.
This file is an ADR archive, not a roadmap or implementation checklist. If current product guidance and historical notes appear to conflict, follow `AGENTS.md` for current direction and use this file to understand why underlying constraints exist.

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

**Why:** Adding js-libp2p would exceed the 175KB bundle limit by ~3×. Trystero already provides WebRTC negotiation. Changing the room name (`fenhollow-tavern-2`) achieves the same isolation as a separate pub-sub topic at zero additional dependency cost.

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

**Use instead:** `seededRNG(hashStr(seed_string))` — defined in `src/rules/utils.js:seededRNG`.  
**Enforced by:** `src/rules/world.js` (all event/weather/mood derivation uses seededRNG), `arbiter/index.js` (beacon and fraud logic).

---

## ADR-009: No new npm dependencies

**Status:** Non-negotiable
**Do not:** Run `npm install <anything>` without explicit approval.

**Why:** Bundle size limit is 500KB minified (current build ~297KB; raised from 175KB → 250KB in Phase 8.2, then to 500KB in Phase 8.95g to accommodate procedural tile art and shape data). Every new dependency risks exceeding it. Trystero (torrent), esbuild, and jest are the full dependency set by design. Treat growth over ~50KB as a design review trigger.

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

---

## ADR-014: `player:move` is reserved for room transitions only

**Status:** Decided (Phase 8.3 hardening)
**Do not:** Emit `player:move` for same-room tile steps, camera nudges, or generic "position changed" updates.

**Why:** UI and audio consumers treat `player:move` as a room transition event. Overloading it for ordinary tile motion caused duplicate room banners, incorrect menu resets, and event payload drift. Same-room motion must use a distinct event (`player:step`) so listeners can opt into the lower-level signal explicitly.

**Enforced by:** `src/systems/movement-system.js` (emits `player:step` for tile motion, `player:move` only on `mapId` change), `src/main/events.js` (room-transition side-effects gated on `player:move`).

---

## ADR-015: Authored exit aliases may exist in content but not in directional UI by default

**Status:** Decided (Phase 8.3 hardening)
**Do not:** Surface arbitrary exit keys such as `mill`, `hallway`, `northwest`, or other authored aliases as direct move buttons/autocomplete unless the command parser and movement rules explicitly support them.

**Why:** The room graph may need non-cardinal aliases for reciprocity, secret links, or authored topology, but the primary movement grammar remains `north/south/east/west/up/down`. UI that blindly mirrors `loc.exits` creates false affordances and breaks player trust. Content topology and player-facing movement affordances are related but not identical.

---

## ADR-016: Referential content integrity is mandatory

**Status:** Decided (Phase 8.3 hardening)
**Do not:** Introduce item ids, quest targets, NPC ids, enemy ids, or room references in authored content unless they resolve to a defined entity and are covered by validation or tests.

**Why:** Several regressions came from authored data referencing nonexistent items or from room prose/UI/runtime disagreeing about the same room. Content is code in this project: if IDs do not resolve cleanly, the build may still pass while gameplay silently degrades. Validation and regression tests must be updated in the same change that introduces new authored references.

**Enforced by:** `src/content/validate.js` (runtime referential integrity check — run via `npm run validate:content`), `src/tests/content.test.js` (regression suite for id resolution).

---

## ADR-017: The default public command surface is intentionally smaller than the internal command/runtime surface

**Status:** Decided (Phase 8.4)
**Do not:** Assume every implemented command or protocol path belongs in the player-facing UI, help text, or autocomplete.

**Why:** Commands such as `say`, `wave`, `bow`, `cheer`, and `vision` added complexity without improving the current core loop. Trade and duel also remain implemented but are not first-class product features yet. The default surface should prioritize the adventure loop: movement, combat, inventory/use/equip, crafting, quests, shops, bank, map, status, and stats.

---

## ADR-019: HUD and status stats are top-aligned to avoid obscuration

**Status:** Decided (Phase 8.55e)
**Do not:** Move the player status HUD (HP, Gold, Hunts) back to the bottom of the canvas.

**Why:** The mobile-first UI features a large fixed `#action-buttons` panel at the bottom of the screen. Since the game canvas is scaled to fit and centered, a bottom-aligned HUD is frequently obscured by the buttons and safe-area insets. Moving player stats to the top bar (merging with the Environment Bar) ensures high-visibility information remains accessible at all times without competing for the same space as interaction controls.

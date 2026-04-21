# P2P Micro-MMO Architecture Plan
*Revised: lib audit, seed-based determinism, Pi memory model*

---

## Vision & Motivation

A **micro cosy metaverse** — a living, persistent fantasy world that costs almost nothing to run and survives independently of any corporation or single operator. Spiritually: *Stardew Valley meets Legend of the Red Dragon (L.O.R.D.)*, with Blaseball's emergent community storytelling underneath.

The world keeps ticking while players are offline. The LLM gives it a voice. The players make it a place worth living in.

**Infrastructure target:** $0/month (realistically ~$3/year in Pi electricity).

---

## Core Gameplay & Scope

- **Phase 1 (MVP):** Text-based MUD. Minimal assets, tolerant of P2P latency, gets the engine right before adding visuals.
- **Phase 5+:** 2D Zelda-like graphical client using Kontra.js or WASM, layered on top of the same state/network core.
- **Game loop:** Daily-turn based. Players tend a homestead, visit the shared town, venture into the wilderness. The world changes overnight. Each morning there is news.
- **Social glue:** Persistent consequences (PvP deaths appear in the daily news by name), end-of-season community elections that alter the world, a leaderboard, scarcity and trade.
- **The secret sauce:** A feedback loop — player actions feed the event log → the narrative engine reads it → writes world deltas back → players encounter a changed world → act differently → repeat. Nobody authors the civil unrest. It emerges.

---

## Lib Audit

Everything justified against Pi Zero W constraints (512MB RAM, ARMv6, $0 budget) and actual job being done.

| Lib | Where | Decision | Reason |
|---|---|---|---|
| Yjs | Pi + browser | **Keep** | CRDT P2P sync — irreplaceable for the serverless model |
| Trystero | Pi + browser | **Keep** | Zero-config WebRTC — nothing lighter exists |
| llama.cpp | Pi (cron only) | **Keep** | Local inference — irreplaceable |
| WebCrypto Ed25519 | Browser | **Keep** | Built into every browser — zero install |
| XState | Pi | **Cut** | Replaced by ~50 lines of plain JS transition tables |
| y-indexeddb | Browser | **Cut** | Player state is a small signed JSON blob — localStorage is sufficient |
| WebTorrent | Browser | **Cut** | GitHub Pages already serves the static client directly |
| IPFS/Kubo | Pi | **Cut** | ~150MB Go binary — can't coexist with LLM on 512MB. Pi pushes `state.json` to GitHub Pages nightly instead |
| coturn | Pi | **Cut** | STUN handles majority of NAT cases. Accept the edge case, remove the process |
| Nostr | Pi | **Deferred** | Useful for discovery and social feed — v2 concern |

**Final stack:**
```
Browser:  Yjs, Trystero, WebCrypto (built-in), localStorage (built-in)
Pi:       Yjs, Trystero, llama.cpp binary, plain JS arc logic
Dist:     GitHub Pages (static PWA)
```

Two npm packages each side. Everything else is platform APIs or plain JS.

---

## Pi Memory Model

The Pi cannot run everything simultaneously. The nightly cron window is the solution.

**Idle (23.5 hrs/day):**
```
OS overhead                          ~80MB
Node.js (Yjs + Trystero + arbiter)   ~130MB
─────────────────────────────────────────────
Total:                               ~210MB
Free:                                ~300MB headroom
```

**Nightly cron window (~30 min):**
```
1. Gracefully stop Node arbiter
2. Load llama.cpp + RWKV7-0.4B       ~380MB
3. Run inference → write delta JSON
4. Unload llama.cpp
5. Restart Node arbiter → apply delta → broadcast via Yjs
```

The model never runs alongside the arbiter. Fits comfortably within 512MB with no swap.

---

## Seed-Based Determinism

The entire simulation is deterministic and reconstructable from two values:

```
world_seed    (hex string, set once at game creation)
event_log     (append-only array, everything that has happened)
```

Any peer replays the event log from the seed to reconstruct exact world state. This keeps the Yjs sync payload minimal — only new events are synced, not full state blobs.

### Seed Hierarchy

```
world_seed
├── Initial world layout (geography, NPC names, starting conditions)
└── season_seed = hash(world_seed + season_number)
    └── daily_seed = hash(world_seed + day_number)
        ├── Drives Markov mood transitions
        ├── Weather and atmosphere
        ├── Arc trigger probabilities
        └── Any other daily randomness
```

Each day's seed is derived purely from world_seed and the day counter. No PRNG state needs to be synced across peers — every peer computes the same daily seed independently and arrives at identical results.

### Seeded PRNG

All randomness in the simulation must use the daily seed, never `Math.random()`:

```js
// Lightweight seeded PRNG (mulberry32) — zero dependency
function seededRNG(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
}

// Each day tick
const dailySeed = hashStr(worldSeed + worldState.day)
const rng = seededRNG(dailySeed)

// All arc transitions, Markov steps, weather — use rng, not Math.random()
const nextMood = markovStep(currentMood, rng)
const arcFired = rng() < arcTriggerProbability
```

### Determinism Requirements

- Integer math only throughout — no floats that can drift between platforms
- All game logic runs through the same transition functions on every peer
- Seeded PRNG re-seeded at the start of each day tick
- Event log is the canonical record — if two peers disagree, replay from seed resolves it

---

## The Two-Layer Architecture

**The most important design principle: the simulation decides what happens; the LLM only describes how it feels.**

```
SIMULATION LAYER (deterministic, always running, cheap)
├── Plain JS arc machines     — narrative shapes unfolding over time
├── Markov chains             — town mood drift, seeded daily
├── Season clock              — 30-day cycles biasing arc types
├── Threat meter              — wilderness danger gating events
├── Production rules          — structural world changes (if/then)
└── Event log                 — everything above writes here

         ↓ (nightly cron, batch, ~30 min)

NARRATIVE LAYER (LLM, prose only)
└── Reads world state + last 7 days of event log
    → outputs headline, town news, rumour, NPC whisper, world delta
    → delta validated and applied back to world state
    → players read it on login
```

The LLM never makes game decisions. If it hallucinates, only text is affected — world state is safe.

---

## Narrative Arc System (Plain JS)

No library. Arc state lives in the Yjs world doc as plain fields. Migrating to XState later is a direct swap — the transition tables are identical, just wrapped differently.

```js
const arcTransitions = {
  escalation: {
    seed:        { ESCALATE: 'growth' },
    growth:      { ESCALATE: 'crisis', RESOLVE: 'resolution' },
    crisis:      { PLAYER_ACTS: 'resolution', IGNORE: 'catastrophe' },
    resolution:  { NEW_THREAT: 'seed' },
    catastrophe: { REBUILD: 'seed' }
  },
  mystery: {
    clue_1:      { DISCOVER: 'clue_2' },
    clue_2:      { DISCOVER: 'reveal' },
    reveal:      { ACT: 'consequence' },
    consequence: { RESOLVE: 'clue_1' }
  },
  rivalry: {
    meet:        { CONFLICT: 'conflict' },
    conflict:    { ESCALATE: 'escalation', TRUCE: 'truce' },
    escalation:  { WIN: 'dominance', NEGOTIATE: 'truce' },
    dominance:   { CHALLENGE: 'meet' },
    truce:       { BREAK: 'conflict' }
  },
  downfall: {
    hubris:      { WARNING: 'warning' },
    warning:     { IGNORE: 'collapse', HEED: 'hubris' },
    collapse:    { SURVIVE: 'aftermath' },
    aftermath:   { REBUILD: 'hubris' }
  },
  bounty: {
    emergence:   { HUNT: 'hunt' },
    hunt:        { CLIMAX: 'climax' },
    climax:      { RESOLVE: 'resolution' },
    resolution:  { NEW_CYCLE: 'emergence' }
  }
}

function transition(arc, event) {
  return arcTransitions[arc.type]?.[arc.beat]?.[event] ?? arc.beat
}
```

Seasons bias which arc types activate via the seeded daily RNG:
```
winter  → escalation, downfall more likely
spring  → mystery, discovery
summer  → rivalry
autumn  → bounty, downfall
```

---

## World State & Event Sourcing

```json
{
  "world_seed": "a3f9c2d1",
  "day": 47,
  "season": "winter",
  "season_number": 2,
  "town_mood": "fearful",
  "threat_level": 3,
  "market_scarcity": ["wheat", "medicine"],
  "active_arcs": [
    {
      "id": "dragon_escalation",
      "type": "escalation",
      "beat": "crisis",
      "seed_event": "dragon spotted north ridge day 31"
    }
  ],
  "event_log": [
    { "day": 45, "type": "player_kill", "entity": "Tyson", "detail": "cave troll near ruins" },
    { "day": 46, "type": "crop_failure", "entity": "Mira", "detail": "frost damage" },
    { "day": 46, "type": "threat_escalation", "detail": "dragon circled lower" }
  ]
}
```

World state is a `Y.Map` in the Yjs doc. Arc state is fields inside it. Event log is a `Y.Array`. All peers stay in sync automatically via Trystero transport.

---

## Player Progress Storage

Player progress is personal, needs to survive browser close and Pi death, and must be tamper-resistant.

```
localStorage (browser)
└── stores signed player snapshot as JSON string
    └── fast, zero library, survives browser restarts

Signed snapshot (tamper resistance)
└── Pi signs the snapshot with its Ed25519 master key
    └── includes last_event_id for cross-checking against event log
    └── Pi verifies signature on any contested action

GitHub Pages cold recovery
└── Pi pushes state.json nightly via GitHub API
    └── new cold-joining player with zero peers fetches this
    └── contains current world state snapshot + Trystero room ID
```

### Player Snapshot Schema

```json
{
  "playerId": "ed25519-pubkey",
  "level": 7,
  "gold": 340,
  "inventory": ["sword", "potion"],
  "homestead": { "crops": ["wheat", "carrot"], "day_planted": 44 },
  "last_event_id": "evt_892",
  "signature": "ed25519-sig-from-pi"
}
```

---

## Network Architecture

### State Sync: Yjs

Yjs doc is the single source of truth for world state, using Trystero as transport.

```
Y.Map   'world'   → season, day, mood, threat, scarcity
Y.Map   'arcs'    → active arc states and current beats
Y.Array 'events'  → append-only event log (rolling 14-day window)
```

### Signaling: Trystero with Multiple Strategies

```js
import { joinRoom } from '@trystero-p2p/nostr'    // default
import { joinRoom } from '@trystero-p2p/torrent'  // fallback
```

Swap strategy if one fails. BitTorrent trackers have run 20+ years with zero corporate backing.

### Arbiter Election

Pi is the peer that never leaves — not a command-and-control server.

```js
function electArbiter(peers, piPeerId) {
  // Deterministic — all peers compute the same result independently
  return [...peers, piPeerId].sort()[0]
}
```

When arbiter changes, Yjs doc state transfers automatically — no special handoff needed.

### Room-Based Mesh

- World sharded into discrete rooms (max 10–20 peers per mesh)
- Yjs changes broadcast within room mesh via Trystero data channels
- Pi lurks in populated rooms, persists final Yjs state when room empties
- Pi validates contested player actions against event log

---

## The Micro-LLM

### Model

**RWKV7-0.4B (Q4 quantised):** ~280MB model, ~380MB at runtime. Recurrent architecture — memory stays constant regardless of context length. Ideal for reading a 14-day event log. Actively developed under Linux Foundation, improves with each version without hardware requirement growing.

Fallback: **Qwen2.5-0.5B** — better instruction following, slightly tighter fit (~450MB runtime, borderline).

### Runtime

llama.cpp runs as a local HTTP server. Node hits `http://localhost:8080/completion`. Model is a swappable GGUF file — when RWKV8 drops, swap the file, nothing else changes. Grammar-constrained JSON output guarantees valid schema every run.

### LLM Prompt Contract

Input: compact world state (season, day, town mood, threat, scarcity, active arc beats with seed events, last 7 days of event log, player roster).

Output: JSON only, no preamble:
```json
{
  "headline": "one evocative sentence, max 12 words",
  "town_news": "2-3 sentences, warm/folksy, uses player names",
  "rumour": "one sentence of hearsay, may be slightly false",
  "npc_whisper": "one NPC says something, include NPC name",
  "world_delta": {
    "town_mood_change": -1,
    "new_scarcity": ["bread"],
    "lifted_scarcity": [],
    "new_event_tag": "healer_prices_rising"
  }
}
```

### Nightly Job Flow

```
cron (midnight)
  1. Stop Node arbiter process
  2. Start llama.cpp server
  3. buildPrompt(worldState)
  4. POST to localhost:8080
  5. validateDelta(response)
  6. Stop llama.cpp server
  7. Restart Node arbiter
  8. applyDelta → write to Yjs world doc → broadcast to peers
  9. Push state.json to GitHub Pages via API
```

---

## Blaseball-Inspired Community Mechanics

- **Seasonal elections:** End of each 30-day season, players vote on one world change. Arc machines respond. LLM announces the outcome.
- **Named folklore:** Player deeds appear in daily news by name. Deaths, heroics, and disasters become community memory.
- **Developer as stagehand:** Let the simulation be weird. If something emergent happens, narrate it as canon. The seeded RNG is a better writer than any of us.

---

## Distribution & Discovery

### Client

Static HTML/JS/CSS on GitHub Pages (<50KB). Web App Manifest makes it installable as a PWA — no App Store, no Google Play.

```json
{
  "name": "Hearthwick",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#1a1a2e"
}
```

### Cold Start

```
GitHub Pages: /state.json
└── updated nightly by Pi via GitHub API
    └── contains: world state snapshot + Trystero room ID
    └── new cold-joining player with zero peers fetches this
```

One `fetch` call. No library. No pinning service.

### Phase 2 (v2) — Nostr Layer

When the game needs to exist outside itself: Pi publishes daily narrative as signed Nostr events, players follow the game's npub in any Nostr client, player identity becomes a Nostr keypair. Not needed for the experiment.

### itch.io

List the game on itch.io for discovery. Links to the GitHub Pages PWA. Zero cost. Audience that appreciates experimental architecture.

---

## Security & Anti-Cheat

- **Action signatures:** Every player action signed with Ed25519 private key (generated on first visit via WebCrypto, stored in localStorage)
- **Deterministic validation:** Peers re-run game logic locally before merging Yjs operations. Impossible state changes rejected before merging.
- **Pi arbiter:** Lurks in rooms. Detects impossible state, broadcasts signed rollback, blacklists offending public key.
- **Signed player snapshots:** Pi signs daily snapshots. Tampered snapshots fail verification on next contested action.
- **Seeded determinism:** All peers compute identical daily outcomes from world_seed + day_number. Any peer can verify any other peer's state transition.

---

## Technical Stack

| Layer | Technology | Why |
|---|---|---|
| Client UI (Phase 1) | Vanilla JS / HTML / CSS | Tiny, no build step |
| Client UI (Phase 5+) | Kontra.js or WASM | Lightweight 2D |
| Distribution | GitHub Pages + PWA | Zero cost, no server |
| Networking | Trystero (Nostr + BitTorrent) | Serverless, resilient signaling |
| State sync | Yjs | CRDT, offline-first, Pi + browser |
| Player persistence | localStorage | Small signed JSON blob, zero library |
| Narrative simulation | Plain JS transition tables + seeded RNG | ~100 lines, XState-upgradeable |
| Determinism | world_seed + daily_seed + mulberry32 PRNG | Zero dependency, fully reconstructable |
| Narrative prose | RWKV7-0.4B via llama.cpp | Constant memory, improving over time |
| Identity / crypto | WebCrypto Ed25519 | Built into every browser since 2025 |
| Cold recovery | GitHub Pages `state.json` | Pi pushes nightly, one fetch to bootstrap |

---

## Implementation Phases

### Phase 1: Text Bootstrap (CURRENT)
1. GitHub Pages repo with HTML/JS shell (text-based UI)
2. PWA manifest + QR code bootstrap
3. Ed25519 key generation on first visit (WebCrypto, no lib)
4. `world_seed` generation + event log schema

### Phase 2: Trystero Networking
1. Trystero `joinRoom` with Nostr + BitTorrent strategies
2. `makeAction` handlers for player commands
3. Yjs world doc wired to Trystero transport
4. Test NAT traversal and connection stability

### Phase 3: State Layer + Pi
1. Pi Node.js client — Yjs peer, joins rooms, persists state, seeds to new joiners
2. Plain JS arc machines + Markov mood chain + seeded PRNG
3. Event log writing from all game actions
4. Deterministic replay test — confirm two peers reconstruct identical state from seed + log
5. Arbiter election logic

### Phase 4: Narrative Engine + Security
1. Pi nightly cron — llama.cpp inference → world delta → Yjs broadcast
2. Pi arbiter validation (anti-cheat logic)
3. GitHub Pages `state.json` nightly push
4. Signed player snapshots
5. Seasonal election mechanic (community voting)

### Phase 5: Graphical Client
1. Kontra.js renderer reading from same Yjs world state
2. World events expressed visually (new tile, spawn, closed shop)
3. Same narrative engine — no changes required

---

## Constraints & Mitigations

| Constraint | Mitigation |
|---|---|
| Pi Zero W: 512MB RAM | Nightly cron pattern — Node arbiter and LLM never run simultaneously |
| Pi Zero W: ~0.5 tok/sec inference | Acceptable for async nightly batch — 500 tokens ≈ 3 min |
| Signaling reliability | Multiple Trystero strategies (Nostr + BitTorrent); graceful "Dialing..." UI |
| Pi hardware death | Yjs syncs state across all active peers; GitHub Pages holds cold snapshot; any peer can become arbiter |
| Zero-peer cold start | GitHub Pages `state.json` updated nightly closes the bootstrap gap |
| NAT traversal edge cases | STUN handles ~85% of cases; accept occasional failure for $0 |
| Float drift across platforms | Integer-only math + mulberry32 seeded PRNG enforced throughout |

---

## The Survival Model

The game survives if even one player cares enough to run a Pi. That's the social contract — and it's how MUDs survived for decades.

The arbiter role is transferable: any player can run the Pi software, hold the master key, keep the world alive. The world doesn't belong to the developer. It belongs to whoever loves it enough to tend it.

```
Corporate infrastructure required:    none
Monthly cost at 100 players:          ~$0.25 (Pi electricity)
Monthly cost at 1000 players:         ~$0.25 (peers are the infra)
What kills it:                        nobody caring enough to run a Pi
What saves it:                        one person who does
```

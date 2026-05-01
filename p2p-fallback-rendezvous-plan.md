# P2P Fallback Rendezvous Plan

## Goal

Preserve BitTorrent/WebTorrent as the primary discovery path while adding a first-party fallback ladder that improves peer connection reliability when public trackers are empty or degraded.

This plan is intentionally biased toward:

- best-effort openness for third-party clients
- zero-dollar or near-zero-dollar operation
- no hard dependency on Cloudflare
- keeping the Pi Zero W arbiter lightweight enough to remain viable

## Product Position

The protocol remains P2P-first and BitTorrent-first.

- Open path:
  - third-party clients can continue using tracker-based discovery only
  - arbiter HTTP hint bootstrap may remain broadly accessible
- Official-client advantage:
  - official clients may use an additional fallback signaling mailbox
  - this improves reliability without replacing the open torrent path

This gives room for future monetization through reliability and UX rather than by closing the base protocol.

## Design Constraints

1. BitTorrent/WebTorrent stays primary.
2. Fallback engages only when discovery is empty or stalled.
3. Cloudflare is acceptable as an accelerator, but not a hard requirement.
4. The Pi Zero W must not become a large-scale live signaling hub.
5. The system should degrade gracefully if Cloudflare is unavailable.
6. TURN remains the final NAT traversal fallback, not the primary connection method.

## Current Codebase State

The existing code already provides part of the ladder:

- `src/networking.js`
  - global room + shard room
  - `seeking_shard`
  - `presence_bootstrap`
  - shard rejoin and TURN escalation
  - arbiter `/peers?shard=` fetch hook
  - arbiter `/register` presence registration hook
- `arbiter/index.js`
  - bounded `presenceCache`
  - `GET /peers?shard=...`
  - `POST /register`
  - signed `/state`
- `src/main.js`
  - Gist cold-start state bootstrap
- `src/constants.js`
  - tracker list
  - `ARBITER_URL`
  - STUN/TURN config

The main missing piece is a fallback signaling path that does not depend on public trackers when tracker discovery fails.

## Target Discovery Ladder

### Stage 1: Primary Torrent Discovery

Client behavior:

- join global torrent room
- join shard torrent room
- use existing `seeking_shard` and `presence_bootstrap`
- use current identity and presence handshake path

Success condition:

- at least one shard peer discovered within the initial discovery window

### Stage 2: Arbiter HTTP Hint Bootstrap

Trigger:

- no shard peers after initial discovery timeout

Client behavior:

- fetch `GET /peers?shard=<shard>`
- seed ghost entries
- prefer recently active peers only
- re-attempt directed presence and shard healing

Server behavior:

- Pi arbiter continues serving `/register` and `/peers`
- presence entries remain short-lived and bounded
- endpoint remains cheap and stateless enough for the Pi

Success condition:

- client learns likely peers in the target shard and can improve bootstrap/reconciliation once a transport path opens

Limitation:

- this does not replace tracker signaling
- it is a hint layer only

### Stage 3: Cloudflare Mailbox Fallback

Trigger:

- tracker discovery empty or stalled
- arbiter hints unavailable or insufficient

Client behavior:

- connect to a shard-scoped mailbox endpoint
- publish presence and read pending rendezvous messages
- exchange full WebRTC signaling payloads as fallback only
- close or hibernate once peer connection succeeds

Service behavior:

- Cloudflare acts as fallback rendezvous, not the default transport
- mailbox keeps short-lived state only
- shard-scoped routing limits fanout

Success condition:

- peers can exchange WebRTC signaling even when trackers fail

Important:

- this is official-client-preferred, not required for third-party clients
- clients must still function without it, just less reliably

### Stage 4: TURN Escalation

Trigger:

- signaling succeeded but direct ICE connectivity still fails

Client behavior:

- rejoin/retry with TURN-enabled ICE config

## Architecture Split

### Pi Zero W Arbiter Responsibilities

Allowed:

- signed world state
- `/state`
- `/register`
- `/peers?shard=...`
- bounded presence cache
- freshness filtering
- cheap metrics/logging

Not allowed:

- long-lived signaling WebSockets for the whole player base
- tracker-equivalent announce fanout
- full live rendezvous coordination at 50k scale

Reason:

HTTP hint bootstrap is cheap enough for the Pi. Live signaling at scale is not.

### Cloudflare Responsibilities

Allowed:

- optional signaling mailbox
- short-lived per-shard peer rendezvous state
- offer/answer/candidate relay
- idle connection hibernation when possible

Not allowed:

- becoming the mandatory first-hop for every client

Reason:

Cloudflare should improve reliability, not become a single operational dependency.

## Openness Boundary

Recommended split:

- Open:
  - torrent room scheme
  - tracker-first discovery
  - arbiter `/peers` hint bootstrap
- Official-client-preferred:
  - Cloudflare fallback signaling mailbox

Tradeoff:

- More openness means less product differentiation and more abuse/scaling exposure.
- More official-client preference means stronger reliability and monetization options.

This plan chooses best-effort openness rather than strict parity.

## Cloudflare Mailbox Protocol

Minimum viable protocol:

### Identity

- peer identity remains the existing Ed25519/public-key-derived model
- mailbox messages include:
  - `shard`
  - `fromPeerId`
  - `fromPublicKey`
  - `targetPeerId`
  - `type`
  - `payload`
  - `ts`

### Message Types

- `hello`
- `offer`
- `answer`
- `ice_candidate`
- `bye`

Optional:

- `presence_hint`
- `connect_ack`

### Validation

- require shard match
- reject stale messages older than short TTL
- cap mailbox length per shard and per peer
- optionally sign envelope metadata if needed for abuse resistance

### State Model

- one mailbox namespace per shard
- short TTL for messages
- short TTL for peer presence
- explicit cleanup after successful connection

## Client Integration Plan

### `src/networking.js`

Add:

- a discovery stage state machine
- explicit timeout thresholds per stage
- mailbox fallback activation only when:
  - shard peers are `0`
  - and tracker/global recovery has not succeeded
- mailbox success path feeding into existing presence and move handshake flow

Do not replace:

- current torrent room join path
- current `seeking_shard`
- current `presence_bootstrap`
- current TURN healing

### `src/constants.js`

Add config for:

- `MAILBOX_URL`
- mailbox enable/disable flag
- fallback timeout tuning

Keep:

- current tracker/STUN/TURN constants

### `src/main.js`

Add:

- optional debug display of current discovery stage
- optional logging for:
  - tracker discovery success
  - arbiter hint fetch
  - mailbox fallback activation
  - TURN escalation

### `arbiter/index.js`

Tighten:

- `/register` validation
- `/peers` filtering by freshness and shard
- bounded cache retention policy
- optional simple rate limiting if needed

Do not add:

- long-lived signaling sockets

## Scaling Model

### What scales on the Pi

Reasonably scalable:

- short HTTP requests
- a small bounded presence map
- periodic state signing

Not scalable on the Pi:

- tens of thousands of live sockets
- message fanout signaling
- tracker-like real-time coordination

### What scales via fallback-only Cloudflare usage

If mailbox usage is only activated on tracker failure or empty discovery, Cloudflare load should stay much lower than “every client uses signaling all the time.”

The intent is:

- normal case: torrent handles discovery
- degraded case: mailbox helps recovery

This is the key to staying near zero dollars.

## Abuse and Cost Controls

Requirements:

- mailbox only after local discovery timeout
- mailbox only for the current shard
- short message TTL
- cap total pending messages per shard
- cap messages per peer per minute
- avoid permanent subscriptions where polling or short-lived attachment is enough

Goal:

- keep fallback traffic bounded so the free tier is not consumed by routine joins

## Testing Plan

### Preserve Current Tests

- deterministic browser two-peer suite remains baseline
- live tracker-based browser suite remains canary

### New Tests To Add

1. Mailbox fallback browser test
   - simulate tracker failure
   - verify peers connect through fallback signaling
   - verify name propagation and movement replication

2. Stage-escalation test
   - no peers via torrent
   - `/peers` fetch happens
   - mailbox fallback activates after timeout
   - TURN escalation only happens after signaling path exists

3. Arbiter bootstrap test
   - `/register` stores shard presence
   - `/peers` returns only fresh entries for the requested shard

4. Mailbox TTL and cleanup test
   - stale signaling messages are evicted
   - successful connections clear state

### Diagnostics

Add structured debug output for:

- tracker peer counts
- current discovery stage
- arbiter hint fetch result count
- mailbox activation
- mailbox message exchange success/failure
- TURN escalation reason

## Implementation Sequence

### Phase A: Tighten Arbiter Bootstrap

- enable and validate `ARBITER_URL` path
- harden `/register`
- harden `/peers`
- add freshness rules and diagnostics

### Phase B: Add Discovery Stage Machine

- formalize stage transitions in `src/networking.js`
- make the current healing logic stage-aware
- avoid overlapping recovery loops

### Phase C: Add Cloudflare Mailbox Fallback

- implement fallback signaling mailbox
- integrate full WebRTC signaling exchange path
- keep it optional and fallback-only

### Phase D: Add Browser Test Coverage

- tracker-failure to mailbox-fallback end-to-end test
- arbiter bootstrap tests
- repeated soak runs with diagnostics

### Phase E: Review Product Boundary

- confirm whether official-client-preferred fallback still feels acceptable
- decide what public documentation to provide for third-party clients

## Acceptance Criteria

The work is successful when:

1. Torrent remains the first and primary discovery path.
2. Official clients can still connect when public trackers are degraded.
3. The game remains playable when Cloudflare is unavailable.
4. The Pi arbiter does not take on large-scale live signaling load.
5. Third-party clients can still participate via the torrent-first path.
6. Browser E2E coverage proves tracker-failure fallback behavior.

## Open Decisions Before Execution

1. Whether arbiter `/peers` remains fully open or lightly gated.
2. Whether mailbox access is fully open, token-gated, or official-client-only by convention.
3. The exact timeout values for:
   - initial tracker discovery
   - arbiter hint fetch
   - mailbox escalation
   - TURN escalation
4. How much discovery telemetry should be surfaced in the in-game debug UI.

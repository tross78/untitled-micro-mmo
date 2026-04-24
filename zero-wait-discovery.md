# Implementation Plan: Operation Hearthwick Speedrun (Zero-Wait Discovery)

This plan implements a high-performance "Fast-Path" discovery stack to reduce the "[System] Connected" time from ~16 seconds to < 500ms, while ensuring the architecture can scale to 50,000 concurrent users (CCU) on a Pi Zero W.

## Objective
- Achieve sub-second "Connected" status for users.
- Eliminate the "TURN Tax" (ICE gathering delay).
- Remove the "Shard Stampede" bottleneck for high CCU.
- Provide a decentralized fallback discovery stack.

## Proposed Changes

### 1. ICE Server Pruning (Client)
- **File**: `src/constants.js`
- **Change**: Split `ICE_SERVERS` into `STUN_SERVERS` and `TURN_SERVERS`.
- **File**: `src/main.js`
- **Change**: Initialize Trystero with `STUN_SERVERS` only. After 5 seconds, if not connected, re-initialize or inject `TURN_SERVERS`. This allows the 90% of users who don't need TURN to connect instantly.

### 2. Arbiter Discovery Beacon (Arbiter)
- **File**: `arbiter/index.js`
- **Change**: Add two "Fire-and-Forget" discovery beacons:
    - **GitHub Gist**: Updates a secret Gist with the Arbiter's `peerId` and signed `world_state`.
    - **Nostr Beacon**: Signs and broadcasts a "Discovery" event (Kind 1) to 5 public Nostr relays.
- **Impact**: Offloads the discovery load from the slow BitTorrent trackers to high-performance CDN (Gist) and Gossip (Nostr) networks.

### 3. Client "Pre-Flight" Race (Client)
- **File**: `src/main.js`
- **Change**: In the `start()` function, initiate a parallel "Race":
    - Fetch the latest Discovery Beacon from Nostr relays.
    - Fetch the latest Discovery Beacon from the GitHub Gist.
- **UX**: As soon as either returns, verify the signature, update `worldState`, and log `[System] Connected`. The game becomes playable immediately while the P2P swarm warms up in the background.

### 4. Shard Randomization (Client)
- **File**: `src/main.js`
- **Change**: Update `joinInstance` to pick a random `instanceId` between 1 and 5 initially.
- **Impact**: Prevents the "Shard Stampede" where thousands of users hit Instance 1 at the same time, causing a cascading failure.

## Verification Plan

### Automated Tests
- `npm test`: Ensure no regressions in state verification or packet packing.
- New test case: Verify that the `worldState` can be successfully bootstrapped from a JSON blob (simulating the Gist/Nostr fetch).

### Manual Verification
- **Speed Test**: Open the game and measure the time from "Page Load" to "Connected". Target: < 1s.
- **Offline Fallback**: Block Nostr and GitHub URLs in the browser DevTools and verify the game still connects via Trystero Trackers (falling back to the 16s delay).
- **Bundle Size**: Run `npm run build` and check `dist/main.js`. Ensure we remain under the **175KB** hard limit.

## Migration & Rollback
- This update is additive. The existing P2P tracker logic remains as the final fallback.
- Rollback: Simply reverting `src/main.js` and `src/constants.js` will return the game to its previous behavior.

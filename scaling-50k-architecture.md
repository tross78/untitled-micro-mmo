# Scaling to 50k CCU: Architecture & Implementation Plan

## Background & Motivation
The Hearthwick Micro-MMO project aims to support 50,000 concurrent players (CCU) on a $0/month infrastructure, with the global authoritative Arbiter running on a Raspberry Pi Zero W (512MB RAM, 1GHz single-core). The current architecture (replicating the entire player state via Yjs CRDTs over a global Trystero WebRTC mesh) is unsuited for this scale. Yjs tombstones and full-mesh connection counts will cause browser main threads to crash and the Pi Zero to exhaust its memory well before reaching even 1,000 CCU.

To achieve 50k CCU, we must aggressively optimize for Data-Oriented Design, O(1) Arbiter workloads, and spatial partitioning, while keeping our dependency bloat to an absolute minimum.

## Scope & Impact
*   **Networking:** Retaining Trystero but heavily sharding the room IDs to prevent full-mesh flooding.
*   **State Management:** Completely removing Yjs. Global state becomes Signed JSON, and player state becomes ephemeral binary gossiping.
*   **Arbiter:** Shifting the Pi Zero from an active state replicator to a passive Optimistic Rollup validator.
*   **Constraints:** By dropping Yjs and reusing Trystero, we will dramatically *reduce* our bundle size, safely staying under the <175KB mandate.

## Proposed Solution

### 1. Transport Layer: Trystero (Dynamic Rooms)
Instead of introducing the bloat of `js-libp2p` and GossipSub, we will heavily leverage our existing lightweight library, **Trystero**. 
*   Because we are capping instances at 50 players (see below), a 49-connection WebRTC full mesh is completely sustainable for modern browsers.
*   We simply dynamically change the Trystero room ID based on the player's location and instance (e.g., joining `hearthwick-tavern-1` instead of a global `hearthwick` room).
*   This keeps our bundle size well under the 175KB mandate and requires zero new dependencies.

### 2. State Management: Signed JSON & IBLT Set Reconciliation
CRDTs (Yjs) are designed for multi-author conflict resolution. Under this new architecture, global state (Day, Seed) is authored solely by the Arbiter, and player state is ephemeral. 
*   **The Substitute:** We will completely remove Yjs, saving massive memory on the Pi Zero and stripping ~100KB from our bundle size.
*   Global state will simply be a lightweight JSON object signed by the Arbiter's Ed25519 key.
*   **Cutting-Edge Sync (IBLTs/Minisketch):** To synchronize ephemeral player state (movement) across the 50 peers, we will use Invertible Bloom Lookup Tables (IBLTs). Instead of sending full state vectors, peers exchange a tiny mathematical "sketch" of their state. By XORing two sketches together, the algorithm mathematically extracts exactly the missing data. This reduces WebRTC bandwidth by up to 90%, allowing mobile devices to easily handle the mesh.

### 3. Anti-Cheat: State Channels & Optimistic Rollups
The Pi Zero cannot validate 50,000 combat rolls per second. While ZK-SNARKs could theoretically verify the entire world in O(1) time, generating the proofs in-browser would obliterate our 175KB bundle size. Instead, we use Layer-2 crypto-economics:
*   **Combat State Channels:** When Alice and Bob fight, they open a cryptographic "State Channel". They don't broadcast every sword swing. Instead, they exchange signed hashes of their local deterministic combat outcomes. Only the *final* death/loot outcome is broadcast to the room. 
*   **Rollups:** An elected "Proposer" in the instance periodically batches the room's final outcomes into a Merkle root, signs it, and sends this tiny 32-byte hash to the Arbiter.
*   **Fraud Proofs:** If a player tries to cheat in a State Channel (or rage-quits before dying), the victim submits the opponent's last signed hash to the Arbiter as a Fraud Proof. The Arbiter blindly accepts Merkle roots utilizing O(1) CPU, only executing transitions if a Fraud Proof is submitted, resulting in a permanent ban and state rollback.

## Alternatives Considered
*   **js-libp2p & GossipSub:** Rejected. While an industry standard for scalable P2P, the library bloat would destroy our 175KB bundle size mandate. Instance sharding with Trystero achieves the same goal with zero bloat.
*   **Abstract Crowds (Visual Culling):** Rejected. While visually culling players maintains the illusion of a massive crowd, syncing underlying state for 8,000 players in one global room would still overwhelm the transport layer.
*   **Pure Local Consensus:** Rejected. Having no global state verification leaves the network highly vulnerable to organized botnets manipulating the world state.

## Phased Implementation Plan

### Phase 1: State Decoupling & Removing Yjs
*   Remove Yjs from the project dependencies to free up bundle size.
*   Update the Arbiter to broadcast the global state (Day, News, Seed) as an Ed25519-signed JSON object.
*   Implement client logic to verify the Arbiter's signature and update local global state.

### Phase 2: Instance Sharding & Ephemeral State
*   Update `rules.js` to support instance tracking (e.g., `cellar-1`).
*   Implement routing logic: when a player uses `/move`, query the DHT/Tracker for instance capacities and dynamically join the appropriate Trystero room (e.g., `hearthwick-forest_edge-4`).
*   Implement binary packet serialization (TypedArrays) for gossiping ephemeral player state across the Trystero data channels.

### Phase 3: Optimistic Rollup Infrastructure
*   Implement Merkle tree generation for instance state.
*   Create the Proposer election logic (deterministic selection based on peer IDs and timestamps).
*   Add logic for Proposers to submit signed state roots to the Arbiter via a dedicated "global" Trystero room.

### Phase 4: Fraud Proofs & Arbitration
*   Implement local peer monitoring (verifying Proposer roots against locally computed state).
*   Build the Fraud Proof generation and submission mechanism.
*   Update the Arbiter (`arbiter/index.js`) to listen for Fraud Proofs, verify Ed25519 signatures, run the deterministic `resolvePvp`/`resolveAttack` math, and broadcast ban/rollback events.

## Verification
*   **Load Testing:** Utilize headless Puppeteer instances to simulate 50+ nodes joining a single instance to verify sharding logic and Trystero stability under load.
*   **Security Testing:** Create a "malicious client" script that intentionally broadcasts invalid combat rolls or false state roots to verify the Fraud Proof generation and Arbiter ban mechanics.
*   **Bundle Size:** Monitor the `esbuild` output. The removal of Yjs should result in a massive reduction in the final bundle size.

## Migration & Rollback
*   This is a fundamental architecture rewrite. It is recommended to perform this work on a long-lived feature branch (`feat/50k-scaling`).
*   The persistence layer (`localStorage`) schema will change dramatically. A version bump (e.g., `hearthwick_state_v5`) will be required, forcing a hard reset of player state upon deployment.
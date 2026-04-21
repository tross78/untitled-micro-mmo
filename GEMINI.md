# Gemini CLI Project Mandates - Hearthwick (Micro-MMO)

## Project Vision
A **micro cosy metaverse** — a living, persistent fantasy world (Stardew Valley meets L.O.R.D.) with Blaseball-style community storytelling. $0/month infrastructure goal.

## Core Mandates
- **Bundle Size:** Current: **121.1KB**. Target: < 175KB.
- **Determinism:** Seeded RNG (mulberry32) + `event_log`. 
- **Math:** **Integer math only.**
- **Memory:** Pi Zero W constraint (512MB). Sequential Node/LLM execution.
- **Security:** Ed25519 signatures (WebCrypto in browser).

## Current Iteration (v0.4.2 - Arbiter & Simulation)
- [x] Phase 1-3 marked COMPLETED in master plan.
- [x] Native WebCrypto Ed25519 integration.
- [x] Persistent identity stored in localStorage.
- [x] Deterministic simulation dashboard (Day/Mood/Seed).
- [x] Arbiter event sourcing (yevents.push).

## Roadmap & Iterations

### Iteration 4: Narrative Engine (Micro-LLM) (CURRENT)
- [ ] **`llama.cpp` Setup:** Compile specialized ARMv6 build on Pi Zero W.
- [ ] **Model Download:** RWKV7-0.4B (Q4_K_M).
- [ ] **The Cron Window:** Sequential stop/run/start logic on Pi.
- [ ] **"The Ticker" UI:** Visual element in client for news.

### Iteration 5: Security & Anti-Cheat
- [ ] **Action Signing:** Sign every player `/move` with their private key.
- [ ] **Validation:** Peers verify signatures and deterministic logic in `getMove`.
- [ ] **Arbiter Oversight:** Pi detects and rollbacks invalid states.

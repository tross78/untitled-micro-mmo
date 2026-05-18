# VPS Arbiter Plan

Status: **future / not yet implemented.** Today the game runs without a VPS — discovery is Nostr+torrent (raced), world-state beacons travel via the Pi arbiter publishing to a GitHub Gist, and the Pi's HTTP `/peers` and `/register` endpoints are hints only.

This doc records the design the VPS *will* slot into so we don't have to redesign the network layer when we move.

## What the VPS is (and isn't)

- **Is:** a first-party rendezvous relay — a fast, authoritative signaling channel that races alongside Nostr and torrent. A fourth source of peer hints. Public `/state` and `/peers` endpoints for cold start.
- **Isn't:** a game server. No simulation, no authoritative game state, no per-action validation. The arbiter still owns world-state signing and fraud arbitration on the same P2P room everybody else is on; the VPS just makes the signaling round-trip faster.

If the VPS dies, the game must keep working through Nostr+torrent unchanged. That's the load-bearing invariant.

## Why a third strategy and not "replace the others"

Three independent signaling paths means the slowest two can be down (BitTorrent trackers blocked at a corporate firewall, Nostr relay congested) and the third still completes a join inside the 30 s target. Today we race two; the VPS adds a third with much tighter latency under normal conditions.

## How it slots into the current code

The composite-room infrastructure already supports a strategy race:

- `src/network/config.js` — `getSignalStrategies()` reads `?signal=` / `localStorage.fenhollow_signal_strategies` and resolves to a list. Add `'vps'` to `SIGNAL_STRATEGIES` and to `DEFAULT_SIGNAL_STRATEGIES` only when a VPS URL is configured.
- `src/network/config.js` — `buildFastRoomConfig()` builds a `strategyRace` entry per strategy. Add a `vps` entry that carries the WS endpoint and the room id.
- `src/network/transport.js` — `nativeStrategies` maps strategy name → `{ joinRoom }`. Add a thin Trystero-compatible adapter that opens a WS to the VPS and surfaces the same `onPeerJoin` / `onPeerLeave` / `makeAction` shape. The composite room already dedupes payloads across strategies, so VPS messages that also arrive via Nostr won't double-fire.
- `src/network/multi-room.js` — no changes needed. `getRaceWinner()` and `getStrategyTimings()` already let us prove which strategy delivered the first peer.

## VPS-side protocol

Minimal — short-lived signaling messages only.

- `WS /signal?shard=<id>` — one connection per shard. Reconnect with exponential backoff up to 30 s.
- Client → server:
  - `hello { peerId, publicKey }`
  - `offer { to, sdp }`
  - `answer { to, sdp }`
  - `ice { to, candidate }`
  - `bye`
- Server → client:
  - `peers [{ peerId, publicKey }, ...]` on hello (current shard occupants)
  - `peer_join { peerId, publicKey }` / `peer_leave { peerId }`
  - relayed `offer` / `answer` / `ice` from named senders

No game data on the VPS. No persistence beyond connection state. Drop messages over ~16 KB.

Hint endpoints stay as today:

- `GET /state` — last signed world-state beacon (cached from the arbiter, refreshed every 60 s).
- `GET /peers?shard=<id>` — current presence directory (same shape as Pi arbiter today).
- `POST /register` — same shape, same body cap (16 KB).

`/state` is what makes the VPS a viable Gist replacement long-term: clients fetch it on cold start with no rate limiting and no 5 s GitHub round-trip. We *don't* delete the Gist beacon when the VPS goes live — it remains a free fallback and a fail-safe for the day the VPS bill lapses.

## Configuration surface

Same precedence as today (`src/infra/runtime.js` → `getArbiterUrl`):

1. `?arbiter=https://vps.example.com`
2. `localStorage.fenhollow_arbiter_url`
3. `ARBITER_URL` build-time constant

When `getArbiterUrl()` resolves to a non-empty URL, the VPS strategy is added to the front of the race. When it's empty, the race falls back to the current Nostr+torrent pair — no functional change.

## Rollout sequence

1. Stand up the VPS with `/state`, `/peers`, `/register` only — hints, no signaling. Existing client code already reads these via `arbiter-signal.js`. Verify the Pi-style endpoints work and the existing 30 s join still holds.
2. Add the WS signaling endpoint and the client-side VPS strategy adapter behind `?signal=vps,nostr,torrent`. Measure with `getStrategyTimings()` / the `signal:strategy_race_won` audit event.
3. Once VPS wins the race >90 % of cold starts, promote it into `DEFAULT_SIGNAL_STRATEGIES` (still conditional on a configured URL).
4. Migrate the world-state beacon publisher from the Pi → the VPS. Keep the Gist beacon for a release as fail-safe, then retire it.

## Things to deliberately not do on day one

- Don't add SFU/TURN on the VPS. WebRTC stays peer-to-peer; the existing TURN escalation logic handles NAT pathological cases.
- Don't put game state on the VPS. The whole architecture works because the trust boundary is the arbiter signature on the world-state beacon, not "the server said so."
- Don't auth `/peers` or `/state`. They're public hints. The signed beacon is what matters.
- Don't make the client require a VPS URL. Anyone running the game from a static host with no VPS must still get a working game via Nostr+torrent.

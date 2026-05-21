// Node/werift cannot use browser .local host ICE candidates from other
// machines. Rewriting those candidates avoids a buildup of unresolved mDNS
// response listeners on the Pi arbiter while preserving srflx/relay candidates.
export const buildArbiterRoomConfig = (baseConfig) => ({
    ...baseConfig,
    _test_only_mdnsHostFallbackToLoopback: true,
});


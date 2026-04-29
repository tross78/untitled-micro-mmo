// Hybrid Logical Clock — monotonic, causally-ordered, stays close to wall time.
// Based on Kulkarni et al. 2014. Used in CockroachDB, YugabyteDB.

let _wall = 0;
let _logical = 0;

export const sendHLC = () => {
    const now = Date.now();
    if (now > _wall) { _wall = now; _logical = 0; }
    else { _logical++; }
    return { wall: _wall, logical: _logical };
};

export const recvHLC = (remote) => {
    const now = Date.now();
    const rwall = remote.wall ?? 0;
    const rlog = remote.logical ?? 0;
    if (now > _wall && now > rwall) { _wall = now; _logical = 0; }
    else if (rwall > _wall) { _wall = rwall; _logical = rlog + 1; }
    else if (rwall === _wall) { _logical = Math.max(_logical, rlog) + 1; }
    else { _logical++; }
    return { wall: _wall, logical: _logical };
};

// Compare two HLC values. Returns negative if a < b, 0 if equal, positive if a > b.
export const cmpHLC = (a, b) => {
    if (a.wall !== b.wall) return a.wall - b.wall;
    return a.logical - b.logical;
};

// Pack HLC into 6 bytes: 4-byte wall (ms, fits until year 2106), 2-byte logical counter.
export const packHLC = (hlc, view, offset) => {
    view.setUint32(offset, hlc.wall & 0xFFFFFFFF, false);
    view.setUint16(offset + 4, hlc.logical & 0xFFFF, false);
};

export const unpackHLC = (view, offset) => ({
    wall: view.getUint32(offset, false),
    logical: view.getUint16(offset + 4, false),
});

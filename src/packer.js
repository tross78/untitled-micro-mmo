/**
 * Hearthwick Binary Packer
 * Compact Uint8Array serialization for high-frequency messages.
 */

const ROOM_MAP = [
    'cellar', 'hallway', 'tavern', 'market', 
    'forest_edge', 'forest_depths', 'lake_shore', 'bandit_camp', 'mountain_pass',
    'ruins', 'ruins_descent', 'catacombs', 'dungeon_cell', 'throne_room',
    'cave'
];
const EMOTE_MAP = ['waves hello.', 'bows respectfully.', 'cheers loudly!'];
const ENEMY_MAP = [
    'forest_wolf', 'ruin_shade', 'cave_troll', 'bandit', 
    'goblin', 'skeleton', 'wraith', 'mountain_troll'
];
const ACTION_TYPES = ['attack', 'kill', 'loot'];

export const packMove = (from, to) => {
    const buf = new Uint8Array(2);
    buf[0] = ROOM_MAP.indexOf(from);
    buf[1] = ROOM_MAP.indexOf(to);
    return buf;
};

export const unpackMove = (buf) => ({
    from: ROOM_MAP[buf[0]],
    to: ROOM_MAP[buf[1]]
});

export const packEmote = (emoteText) => {
    const idx = EMOTE_MAP.indexOf(emoteText);
    return new Uint8Array([idx === -1 ? 255 : idx]);
};

export const unpackEmote = (buf) => ({
    text: EMOTE_MAP[buf[0]] || 'gestures vaguely.'
});

/**
 * Presence Packet (Fixed Size: 96 bytes)
 * [0-15]  Name (UTF-8, null-padded, truncated to 16 bytes)
 * [16]    Location (Room Index)
 * [17-20] PH (4 bytes from hex)
 * [21]    Level (Uint8)
 * [22-25] XP (Uint32BE)
 * [26-31] TS (48-bit timestamp)
 * [32-95] Signature (64 bytes)
 */
export const packPresence = (p) => {
    const buf = new Uint8Array(96);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

    // Encode then byte-truncate to 16 to avoid overflowing adjacent fields
    const fullName = new TextEncoder().encode(p.name || '');
    buf.set(fullName.subarray(0, 16), 0);

    view.setUint8(16, ROOM_MAP.indexOf(p.location));

    // PH (8 hex chars -> 4 bytes); default to zeros if identity not yet set
    const ph = p.ph || '00000000';
    for (let i = 0; i < 4; i++) {
        buf[17 + i] = parseInt(ph.slice(i * 2, i * 2 + 2), 16);
    }

    view.setUint8(21, p.level);
    view.setUint32(22, p.xp, false); // big-endian

    // TS (low 48 bits)
    const ts = p.ts || Date.now();
    view.setUint16(26, Math.floor(ts / 0x100000000));
    view.setUint32(28, ts % 0x100000000);

    // Signature (Base64 -> 64 bytes); write zeros if missing (e.g. during boot)
    if (p.signature) {
        const sigDecoded = Uint8Array.from(atob(p.signature), c => c.charCodeAt(0));
        buf.set(sigDecoded, 32);
    }

    return buf;
};

export const unpackPresence = (buf) => {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

    // Name
    let nameEnd = 0;
    while (nameEnd < 16 && buf[nameEnd] !== 0) nameEnd++;
    const name = new TextDecoder().decode(buf.subarray(0, nameEnd));

    const location = ROOM_MAP[view.getUint8(16)];

    // PH
    let ph = '';
    for (let i = 0; i < 4; i++) ph += buf[17 + i].toString(16).padStart(2, '0');

    const level = view.getUint8(21);
    const xp = view.getUint32(22, false); // big-endian

    // TS
    const tsHigh = view.getUint16(26);
    const tsLow = view.getUint32(28);
    const ts = tsHigh * 0x100000000 + tsLow;

    // Signature
    const signature = btoa(String.fromCharCode(...buf.subarray(32, 96)));

    return { name, location, ph, level, xp, ts, signature };
};

/**
 * Duel Commit Packet (Fixed Size: 70 bytes)
 * [0]     Round (Uint8)
 * [1]     Damage (Uint8)
 * [2-5]   Day (Uint32BE)
 * [6-69]  Signature (64 bytes)
 */
export const packDuelCommit = (c) => {
    const buf = new Uint8Array(70);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    view.setUint8(0, c.round);
    view.setUint8(1, c.dmg);
    view.setUint32(2, c.day, false);
    const sigDecoded = Uint8Array.from(atob(c.signature), ch => ch.charCodeAt(0));
    buf.set(sigDecoded, 6);
    return buf;
};

export const unpackDuelCommit = (buf) => {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const round = view.getUint8(0);
    const dmg = view.getUint8(1);
    const day = view.getUint32(2, false);
    const signature = btoa(String.fromCharCode(...buf.subarray(6, 70)));
    return { commit: { round, dmg, day }, signature };
};

/**
 * Action Log Packet (Fixed Size: 72 bytes)
 * [0]     Type (Uint8: 0=attack, 1=kill, 2=loot)
 * [1-4]   Action Index (Uint32BE)
 * [5]     Target (Enemy Index)
 * [6-7]   Data (Uint16BE, e.g. damage dealt or item index)
 * [8-71]  Signature (64 bytes)
 */
export const packActionLog = (a) => {
    const buf = new Uint8Array(72);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    view.setUint8(0, ACTION_TYPES.indexOf(a.type));
    view.setUint32(1, a.index, false);
    view.setUint8(5, ENEMY_MAP.indexOf(a.target));
    view.setUint16(6, a.data || 0, false);
    const sigDecoded = Uint8Array.from(atob(a.signature), ch => ch.charCodeAt(0));
    buf.set(sigDecoded, 8);
    return buf;
};

export const unpackActionLog = (buf) => {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const type = ACTION_TYPES[view.getUint8(0)];
    const index = view.getUint32(1, false);
    const target = ENEMY_MAP[view.getUint8(5)];
    const data = view.getUint16(6, false);
    const signature = btoa(String.fromCharCode(...buf.subarray(8, 72)));
    return { type, index, target, data, signature };
};

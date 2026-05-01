// @ts-check
/**
 * Hearthwick Schema-Based Binary Packer
 * Declarative serialization for high-frequency messages.
 */

import { world, ENEMIES } from './data.js';
import { packHLC, unpackHLC } from './hlc.js';

const toUint8Array = (buf) => {
    if (buf instanceof Uint8Array) return buf;
    if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
    if (Array.isArray(buf)) return Uint8Array.from(buf);
    if (ArrayBuffer.isView(buf)) {
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
    if (typeof buf === 'string') {
        try {
            return Uint8Array.from(atob(buf), c => c.charCodeAt(0));
        } catch {
            return Uint8Array.from(buf, c => c.charCodeAt(0));
        }
    }
    if (buf && typeof buf === 'object') {
        if (buf.type === 'Buffer' && Array.isArray(buf.data)) return Uint8Array.from(buf.data);
        const keys = Object.keys(buf);
        if (typeof buf.length === 'number' && keys.every(k => /^\d+$/.test(k))) {
            return Uint8Array.from({ length: buf.length }, (_, i) => buf[i] ?? 0);
        }
    }
    throw new TypeError('Expected binary buffer');
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const readString = (source, offset, length) => textDecoder.decode(source.subarray(offset, offset + length));

class SchemaBuffer {
    constructor(size) {
        this.buf = new Uint8Array(size);
        this.view = new DataView(this.buf.buffer);
        this.offset = 0;
    }
    u8(val) { this.view.setUint8(this.offset++, val); }
    u16(val) { this.view.setUint16(this.offset, val, false); this.offset += 2; }
    u32(val) { this.view.setUint32(this.offset, val, false); this.offset += 4; }
    ts(val) {
        // Legacy: accepts a plain number for move packets (wall ms + 0 logical)
        const t = val || Date.now();
        this.u16(Math.floor(t / 0x100000000));
        this.u32(t % 0x100000000);
    }
    hlc(val) {
        // HLC: 48-bit wall + 16-bit logical counter (8 bytes total)
        packHLC(val || { wall: Date.now(), logical: 0 }, this.view, this.offset);
        this.offset += 8;
    }
    sig(val) {
        if (val) {
            const decoded = Uint8Array.from(atob(val), c => c.charCodeAt(0));
            this.buf.set(decoded, this.offset);
        }
        this.offset += 64;
    }
    str(val, len) {
        const encoder = new TextEncoder();
        const encoded = encoder.encode(val);
        this.buf.set(encoded.subarray(0, len), this.offset);
        this.offset += len;
    }
}

class SchemaReader {
    constructor(buf) {
        this.buf = toUint8Array(buf);
        this.view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
        this.offset = 0;
    }
    u8() { return this.view.getUint8(this.offset++); }
    u16() { const r = this.view.getUint16(this.offset, false); this.offset += 2; return r; }
    u32() { const r = this.view.getUint32(this.offset, false); this.offset += 4; return r; }
    ts() {
        const high = this.u16();
        const low = this.u32();
        return high * 0x100000000 + low;
    }
    hlc() {
        const h = unpackHLC(this.view, this.offset);
        this.offset += 8;
        return h;
    }
    sig() {
        const r = btoa(String.fromCharCode(...this.buf.subarray(this.offset, this.offset + 64)));
        this.offset += 64;
        return r;
    }
    str(len) {
        let end = this.offset;
        while (end < this.offset + len && this.buf[end] !== 0) end++;
        const r = new TextDecoder().decode(this.buf.subarray(this.offset, end));
        this.offset += len;
        return r;
    }
}

// Derived from data.js keys — sorted alphabetically for a stable, self-maintaining index.
// Any new room/enemy added to data.js is automatically included. All peers must use the same sort.
export const ROOM_MAP = Object.keys(world).sort();
export const ENEMY_MAP = Object.keys(ENEMIES).sort();

// Truncates a string to fit within a specific UTF-8 byte length.
// Ensures canonicalization between signed payload and transmitted bytes.
const truncateName = (str, maxBytes) => {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let buf = encoder.encode(str || '');
    if (buf.length <= maxBytes) return str || '';
    // Byte-truncate and decode back to string (strips partial trailing multibyte chars)
    return decoder.decode(buf.subarray(0, maxBytes)).replace(/\0/g, '');
};

const EMOTE_MAP = ['waves hello.', 'bows respectfully.', 'cheers loudly!'];
const ACTION_TYPES = ['attack', 'kill', 'loot'];
const ITEM_MAP = [
    'wolf_pelt', 'old_tome', 'iron_key', 'gold', 'potion', 'ale', 'bread',
    'iron_sword', 'steel_sword', 'magic_staff', 'healing_elixir', 'strength_elixir',
    'bandit_mask', 'wood', 'iron', 'leather_armor', 'iron_armor', 'warm_cloak'
];
const QUEST_MAP = [
    'find_tavern', 'wolf_hunt', 'bandit_sweep', 'cave_troll_bounty',
    'ruins_survey', 'tome_collection', 'catacomb_delve', 'wraith_banish',
    'gather_wood', 'iron_supply', 'craft_sword', 'market_recovery',
    'tavern_regular', 'courier_run', 'mountain_trial'
];

export const presenceSignaturePayload = (p) => {
    const activeQuests = Object.entries(p.quests || {})
        .filter(([, q]) => !q.completed)
        .slice(0, 8);
    const quests = {};
    activeQuests.forEach(([id, q]) => {
        quests[id] = { progress: q.progress || 0, completed: false };
    });
    return {
        name: truncateName(p.name, 16),
        location: ROOM_MAP.includes(p.location) ? p.location : 'cellar',
        ph: (p.ph || '00000000').slice(0, 8),
        level: p.level || 1,
        xp: p.xp || 0,
        x: p.x || 0,
        y: p.y || 0,
        gold: p.gold || 0,
        inventory: (p.inventory || []).slice(0, 16),
        quests,
        hlc: {
            wall: p.hlc?.wall || 0,
            logical: p.hlc?.logical || 0,
        },
    };
};

export const packMove = (m) => {
    const s = new SchemaBuffer(74);
    s.u8(ROOM_MAP.indexOf(m.from));
    s.u8(ROOM_MAP.indexOf(m.to));
    s.u8(m.x || 0);
    s.u8(m.y || 0);
    s.ts(m.ts);
    s.sig(m.signature);
    return s.buf;
};

export const unpackMove = (buf) => {
    const r = new SchemaReader(buf);
    return {
        from: ROOM_MAP[r.u8()] ?? 'cellar',
        to: ROOM_MAP[r.u8()] ?? 'cellar',
        x: r.u8(),
        y: r.u8(),
        ts: r.ts(),
        signature: r.sig(),
    };
};

export const packEmote = (emoteText) => {
    const idx = EMOTE_MAP.indexOf(emoteText);
    return new Uint8Array([idx === -1 ? 255 : idx]);
};

export const unpackEmote = (buf) => ({
    text: EMOTE_MAP[buf[0]] ?? 'gestures vaguely.'
});

export const packPresence = (p) => {
    const s = new SchemaBuffer(160); // Increased size
    s.str(truncateName(p.name, 16), 16);
    s.u8(ROOM_MAP.indexOf(p.location));
    // Pack PH (4 bytes from 8-char hex)
    const phHex = (p.ph || '00000000').slice(0, 8);
    for (let i = 0; i < 4; i++) s.u8(parseInt(phHex.slice(i * 2, i * 2 + 2), 16));
    s.u8(p.level || 1);
    s.u32(p.xp || 0);
    s.u8(p.x || 0);
    s.u8(p.y || 0);
    s.u32(p.gold || 0);
    // Inventory (max 16 items)
    const inv = (p.inventory || []).slice(0, 16);
    s.u8(inv.length);
    for (let i = 0; i < 16; i++) s.u8(inv[i] ? ITEM_MAP.indexOf(inv[i]) : 255);
    // Quests (max 8 active)
    const activeQuests = Object.entries(p.quests || {}).filter(([, q]) => !q.completed).slice(0, 8);
    s.u8(activeQuests.length);
    for (let i = 0; i < 8; i++) {
        const [id, data] = activeQuests[i] || [null, { progress: 0 }];
        s.u8(id ? QUEST_MAP.indexOf(id) : 255);
        s.u8(data.progress || 0);
    }
    s.hlc(p.hlc);
    s.sig(p.signature);
    return s.buf;
};

export const unpackPresence = (buf) => {
    const r = new SchemaReader(buf);
    const name = r.str(16);
    const location = ROOM_MAP[r.u8()] ?? 'cellar';
    let ph = '';
    for (let i = 0; i < 4; i++) ph += r.u8().toString(16).padStart(2, '0');
    const level = r.u8();
    const xp = r.u32();
    const x = r.u8();
    const y = r.u8();
    const gold = r.u32();
    const invLen = r.u8();
    const inventory = [];
    for (let i = 0; i < 16; i++) {
        const idx = r.u8();
        if (i < invLen && idx !== 255) inventory.push(ITEM_MAP[idx]);
    }
    const qLen = r.u8();
    const quests = {};
    for (let i = 0; i < 8; i++) {
        const idx = r.u8();
        const progress = r.u8();
        if (i < qLen && idx !== 255) {
            quests[QUEST_MAP[idx]] = { progress, completed: false };
        }
    }
    const hlc = r.hlc();
    const signature = r.sig();
    return { name, location, ph, level, xp, x, y, gold, inventory, quests, hlc, signature };
};

export const packDuelCommit = (c) => {
    const s = new SchemaBuffer(70);
    s.u8(c.round);
    s.u8(c.dmg);
    s.u32(c.day);
    s.sig(c.signature);
    return s.buf;
};

export const unpackDuelCommit = (buf) => {
    const r = new SchemaReader(buf);
    return {
        commit: { round: r.u8(), dmg: r.u8(), day: r.u32() },
        signature: r.sig()
    };
};

export const packActionLog = (a) => {
    const s = new SchemaBuffer(72);
    s.u8(ACTION_TYPES.indexOf(a.type));
    s.u32(a.index);
    s.u8(ENEMY_MAP.indexOf(a.target));
    s.u16(a.data || 0);
    s.sig(a.signature);
    return s.buf;
};

export const unpackActionLog = (buf) => {
    const r = new SchemaReader(buf);
    return {
        type: ACTION_TYPES[r.u8()],
        index: r.u32(),
        target: ENEMY_MAP[r.u8()] ?? null,
        data: r.u16(),
        signature: r.sig()
    };
};

export const packPresenceBatch = (entries) => {
    const list = Array.isArray(entries)
        ? entries
        : Object.entries(entries || {}).map(([peerId, value]) => ({ peerId, ...value }));
    const normalized = list.map(({ peerId, presence, publicKey }) => {
        const presenceBuf = toUint8Array(presence);
        const peerIdBytes = textEncoder.encode(String(peerId || ''));
        const publicKeyBytes = textEncoder.encode(String(publicKey || ''));
        return { peerIdBytes, publicKeyBytes, presenceBuf };
    });

    const total = 2 + normalized.reduce((sum, rec) => sum
        + 2 + rec.peerIdBytes.length
        + 2 + rec.publicKeyBytes.length
        + 4 + rec.presenceBuf.length, 0);

    const out = new Uint8Array(total);
    const view = new DataView(out.buffer);
    let offset = 0;
    view.setUint16(offset, normalized.length, false); offset += 2;
    for (const rec of normalized) {
        view.setUint16(offset, rec.peerIdBytes.length, false); offset += 2;
        out.set(rec.peerIdBytes, offset); offset += rec.peerIdBytes.length;
        view.setUint16(offset, rec.publicKeyBytes.length, false); offset += 2;
        out.set(rec.publicKeyBytes, offset); offset += rec.publicKeyBytes.length;
        view.setUint32(offset, rec.presenceBuf.length, false); offset += 4;
        out.set(rec.presenceBuf, offset); offset += rec.presenceBuf.length;
    }
    return out;
};

export const unpackPresenceBatch = (buf) => {
    const bytes = toUint8Array(buf);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0;
    const count = view.getUint16(offset, false); offset += 2;
    const out = {};
    for (let i = 0; i < count; i++) {
        const peerIdLen = view.getUint16(offset, false); offset += 2;
        const peerId = readString(bytes, offset, peerIdLen); offset += peerIdLen;
        const publicKeyLen = view.getUint16(offset, false); offset += 2;
        const publicKey = readString(bytes, offset, publicKeyLen); offset += publicKeyLen;
        const presenceLen = view.getUint32(offset, false); offset += 4;
        const presence = bytes.subarray(offset, offset + presenceLen); offset += presenceLen;
        out[peerId] = { presence, publicKey };
    }
    return out;
};

export const packTradeCommit = (t) => {
    const s = new SchemaBuffer(82);
    s.u32(t.gold);
    for (let i = 0; i < 8; i++) s.u8(t.items[i] ? ITEM_MAP.indexOf(t.items[i]) : 255);
    s.ts(t.ts);
    s.sig(t.signature);
    return s.buf;
};

export const unpackTradeCommit = (buf) => {
    const r = new SchemaReader(buf);
    const gold = r.u32();
    const items = [];
    for (let i = 0; i < 8; i++) {
        const idx = r.u8();
        if (idx !== 255) items.push(ITEM_MAP[idx]);
    }
    return { gold, items, ts: r.ts(), signature: r.sig() };
};

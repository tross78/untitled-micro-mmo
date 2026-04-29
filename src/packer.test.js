import { packMove, unpackMove, packEmote, unpackEmote, packPresence, unpackPresence, packDuelCommit, unpackDuelCommit, packActionLog, unpackActionLog } from './packer.js';

describe('Binary Packer', () => {
    test('Move packet encodes/decodes correctly', () => {
        const move = {
            from: 'tavern',
            to: 'market',
            x: 10,
            y: 12,
            ts: 1619184000000,
            signature: btoa('m'.repeat(64))
        };
        const packed = packMove(move);
        expect(packed).toBeInstanceOf(Uint8Array);
        expect(packed).toHaveLength(74);
        
        const unpacked = unpackMove(packed);
        expect(unpacked.from).toBe(move.from);
        expect(unpacked.to).toBe(move.to);
        expect(unpacked.x).toBe(move.x);
        expect(unpacked.y).toBe(move.y);
        expect(unpacked.ts).toBe(move.ts);
        expect(unpacked.signature).toBe(move.signature);
    });

    test('Emote packet encodes/decodes correctly', () => {
        const text = 'cheers loudly!';
        const packed = packEmote(text);
        expect(packed).toBeInstanceOf(Uint8Array);
        expect(packed).toHaveLength(1);
        
        const unpacked = unpackEmote(packed);
        expect(unpacked.text).toBe(text);
    });

    test('Unknown emote falls back to default', () => {
        const packed = new Uint8Array([255]);
        const unpacked = unpackEmote(packed);
        expect(unpacked.text).toBe('gestures vaguely.');
    });

    test('Presence packet encodes/decodes correctly', () => {
        const presence = {
            name: 'Tyson',
            location: 'cellar',
            ph: 'abcdef12',
            level: 5,
            xp: 1000,
            x: 7,
            y: 8,
            ts: 1619184000000,
            signature: btoa('a'.repeat(64))
        };
        
        const packed = packPresence(presence);
        expect(packed).toBeInstanceOf(Uint8Array);
        expect(packed).toHaveLength(160);
        
        const unpacked = unpackPresence(packed);
        expect(unpacked.name).toBe('Tyson');
        expect(unpacked.location).toBe('cellar');
        expect(unpacked.ph).toBe('abcdef12');
        expect(unpacked.level).toBe(5);
        expect(unpacked.xp).toBe(1000);
        expect(unpacked.x).toBe(7);
        expect(unpacked.y).toBe(8);
        expect(unpacked.ts).toBe(presence.ts);
        expect(unpacked.signature).toBe(presence.signature);
    });

    // Catches bug: XP field endianness. If setUint32 uses wrong byte order, large values corrupt.
    test('Presence XP encodes as big-endian: distinct bytes are in correct order', () => {
        const presence = {
            name: 'X', location: 'cellar', ph: '00000000', level: 1,
            xp: 0x01020304, // four distinct bytes — any endianness swap is detectable
            ts: 1700000000000,
            signature: btoa('x'.repeat(64)),
        };
        const packed = packPresence(presence);
        const view = new DataView(packed.buffer);
        expect(view.getUint8(22)).toBe(0x01);
        expect(view.getUint8(23)).toBe(0x02);
        expect(view.getUint8(24)).toBe(0x03);
        expect(view.getUint8(25)).toBe(0x04);
    });

    test('Presence XP values above 0xFFFF round-trip correctly', () => {
        const presence = {
            name: 'X', location: 'cellar', ph: '00000000', level: 1,
            xp: 75000, ts: 1700000000000, signature: btoa('x'.repeat(64)),
        };
        expect(unpackPresence(packPresence(presence)).xp).toBe(75000);
    });

    // Catches bug: timestamp truncation. Modern Unix timestamps (~1.7e12) exceed 32 bits.
    // The 48-bit split must survive the round-trip without losing the high bits.
    test('Presence timestamp round-trips correctly with modern epoch value', () => {
        const ts = 1700000000000; // Nov 2023 — well above 32-bit max (4294967295)
        const presence = {
            name: 'T', location: 'cellar', ph: '00000000', level: 1,
            xp: 0, ts, signature: btoa('x'.repeat(64)),
        };
        expect(unpackPresence(packPresence(presence)).ts).toBe(ts);
    });

    test('Presence packet byte layout matches documented offsets', () => {
        const presence = {
            name: 'AB', location: 'cellar', ph: 'ff000000', level: 7,
            xp: 500, x: 2, y: 3, ts: 1700000000000, signature: btoa('s'.repeat(64)),
        };
        const packed = packPresence(presence);
        const view = new DataView(packed.buffer);
        expect(view.getUint8(16)).toBe(3); // cellar is index 3 in sorted ROOM_MAP
        expect(view.getUint8(21)).toBe(7); // level at byte 21
        expect(packed).toHaveLength(160);
    });

    test('DuelCommit packet encodes/decodes correctly', () => {
        const commit = {
            round: 2,
            dmg: 15,
            day: 123,
            signature: btoa('b'.repeat(64))
        };

        const packed = packDuelCommit(commit);
        expect(packed).toBeInstanceOf(Uint8Array);
        expect(packed).toHaveLength(70);

        const { commit: unpacked, signature } = unpackDuelCommit(packed);
        expect(unpacked.round).toBe(commit.round);
        expect(unpacked.dmg).toBe(commit.dmg);
        expect(unpacked.day).toBe(commit.day);
        expect(signature).toBe(commit.signature);
    });

    test('Unknown room index in move packet falls back to cellar', () => {
        const buf = new Uint8Array(74);
        buf[0] = 255;
        buf[1] = 255;
        const sig = btoa('z'.repeat(64));
        const sigBytes = Uint8Array.from(atob(sig), c => c.charCodeAt(0));
        buf.set(sigBytes, 10); // Offset shift for x/y

        const unpacked = unpackMove(buf);
        expect(unpacked.from).toBe('cellar');
        expect(unpacked.to).toBe('cellar');
    });

    test('Unknown room index in presence packet falls back to cellar', () => {
        const packed = new Uint8Array(98);
        const view = new DataView(packed.buffer);
        view.setUint8(16, 255); // unknown location index
        const unpacked = unpackPresence(packed);
        expect(unpacked.location).toBe('cellar');
    });

    test('Unknown enemy index in action log packet falls back to null', () => {
        const buf = new Uint8Array(72);
        buf[5] = 255; // unknown enemy index
        // Signature must be valid base64 — fill with printable chars
        const sig = btoa('a'.repeat(64));
        const sigBytes = Uint8Array.from(atob(sig), c => c.charCodeAt(0));
        buf.set(sigBytes, 8);
        const unpacked = unpackActionLog(buf);
        expect(unpacked.target).toBeNull();
    });

    // Catches bug: DuelCommit comment said 77 bytes but buffer was 70. Verify the layout
    // exactly: 1 (round) + 1 (dmg) + 4 (day) + 64 (sig) = 70 bytes, no padding.
    test('DuelCommit is exactly 70 bytes with signature occupying bytes 6-69', () => {
        const sig64 = btoa('z'.repeat(64));
        const packed = packDuelCommit({ round: 1, dmg: 5, day: 999, signature: sig64 });
        expect(packed).toHaveLength(70);
        // Signature should be recoverable from subarray(6, 70)
        const recovered = btoa(String.fromCharCode(...packed.subarray(6, 70)));
        expect(recovered).toBe(sig64);
    });
});

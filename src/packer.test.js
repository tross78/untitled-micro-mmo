import { packMove, unpackMove, packEmote, unpackEmote, packPresence, unpackPresence, packDuelCommit, unpackDuelCommit } from './packer';

describe('Binary Packer', () => {
    test('Move packet encodes/decodes correctly', () => {
        const from = 'tavern';
        const to = 'market';
        const packed = packMove(from, to);
        expect(packed).toBeInstanceOf(Uint8Array);
        expect(packed).toHaveLength(2);
        
        const unpacked = unpackMove(packed);
        expect(unpacked.from).toBe(from);
        expect(unpacked.to).toBe(to);
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
            ts: 1619184000000,
            signature: btoa('a'.repeat(64)) // 64-byte fake signature
        };
        
        const packed = packPresence(presence);
        expect(packed).toBeInstanceOf(Uint8Array);
        expect(packed).toHaveLength(96);
        
        const unpacked = unpackPresence(packed);
        expect(unpacked.name).toBe('Tyson');
        expect(unpacked.location).toBe('cellar');
        expect(unpacked.ph).toBe('abcdef12');
        expect(unpacked.level).toBe(5);
        expect(unpacked.xp).toBe(1000);
        expect(unpacked.ts).toBe(presence.ts);
        expect(unpacked.signature).toBe(presence.signature);
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
});

import fc from 'fast-check';
import { packPresence, unpackPresence, presenceSignaturePayload, ROOM_MAP } from '../network/packer.js';

describe('Packer Property-Based Tests', () => {
  test('Presence round-trip: unpack(pack(p)) matches signature payload', () => {
    fc.assert(
      fc.property(
        fc.record({
          name: fc.string({ maxLength: 16 }),
          location: fc.constantFrom(...ROOM_MAP),
          ph: fc.stringMatching(/^[0-9a-f]{8}$/),
          level: fc.integer({ min: 1, max: 100 }),
          xp: fc.integer({ min: 0, max: 1000000 }),
          x: fc.integer({ min: 0, max: 15 }),
          y: fc.integer({ min: 0, max: 15 }),
          gold: fc.integer({ min: 0, max: 999999 }),
          inventory: fc.array(fc.constantFrom('potion', 'bread', 'wood'), { maxLength: 16 }),
          quests: fc.constant({}), // simplify quests for now
          hlc: fc.record({
            wall: fc.integer({ min: 1700000000000, max: 1800000000000 }),
            logical: fc.integer({ min: 0, max: 65535 })
          }),
          signature: fc.base64String({ minLength: 88, maxLength: 88 })
        }),
        (p) => {
          const packed = packPresence(p);
          const unpacked = unpackPresence(packed);
          const originalPayload = presenceSignaturePayload(p);
          const unpackedPayload = presenceSignaturePayload(unpacked);

          expect(unpackedPayload).toEqual(originalPayload);
        }
      )
    );
  });
});

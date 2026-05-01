import fc from 'fast-check';
import { Minisketch } from '../network/minisketch.js';

describe('Minisketch Property-Based Tests', () => {
  test('Reconciliation: added/removed match set difference when within capacity', () => {
    const capacity = 32;
    fc.assert(
      fc.property(
        fc.record({
          common: fc.array(fc.string({ maxLength: 10 }), { maxLength: 50 }),
          localOnly: fc.array(fc.string({ maxLength: 10 }), { minLength: 0, maxLength: 15 }),
          remoteOnly: fc.array(fc.string({ maxLength: 10 }), { minLength: 0, maxLength: 15 }),
        }),
        ({ common, localOnly, remoteOnly }) => {
          // Ensure all IDs are unique to simplify verification
          const allIds = new Set([...common, ...localOnly, ...remoteOnly]);
          if (allIds.size !== common.length + localOnly.length + remoteOnly.length) return;

          const local = new Minisketch(capacity);
          const remote = new Minisketch(capacity);

          common.forEach(id => { local.add(id); remote.add(id); });
          localOnly.forEach(id => local.add(id));
          remoteOnly.forEach(id => remote.add(id));

          const diff = Minisketch.decode(local, remote);

          expect(diff.failure).toBe(false);

          const expectedRemoved = localOnly.map(id => Number(Minisketch.hashId(id))).sort();
          const expectedAdded = remoteOnly.map(id => Number(Minisketch.hashId(id))).sort();

          expect(diff.removed.sort()).toEqual(expectedRemoved);
          expect(diff.added.sort()).toEqual(expectedAdded);
        }
      )
    );
  });
});

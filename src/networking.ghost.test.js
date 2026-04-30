
import { jest } from '@jest/globals';
import { seedFromSnapshot } from './networking.js';
import { players, trackPlayer } from './store.js';

describe('Ghost Presence Logic', () => {
    beforeEach(() => {
        players.clear();
    });

    test('seedFromSnapshot populates players map with ghost entries', () => {
        const snapshot = [
            { name: 'Alice', location: 'cellar', level: 5, ph: 'ab12cd34', ts: Date.now() },
            { name: 'Bob', location: 'tavern', level: 10, ph: 'ef56gh78', ts: Date.now() }
        ];

        seedFromSnapshot(snapshot);

        expect(players.has('ghost:ab12cd34')).toBe(true);
        expect(players.has('ghost:ef56gh78')).toBe(true);
        expect(players.get('ghost:ab12cd34').ghost).toBe(true);
        expect(players.get('ghost:ab12cd34').name).toBe('Alice');
    });

    test('seedFromSnapshot does not overwrite existing real players', () => {
        players.set('peer1', { name: 'Alice', ph: 'ab12cd34', location: 'cellar' });
        
        const snapshot = [
            { name: 'Alice', location: 'tavern', level: 5, ph: 'ab12cd34', ts: Date.now() }
        ];

        seedFromSnapshot(snapshot);

        expect(players.has('ghost:ab12cd34')).toBe(false);
    });

    test('seedFromSnapshot does not overwrite existing ghost players', () => {
        players.set('ghost:ab12cd34', { name: 'Alice', ph: 'ab12cd34', location: 'cellar', ghost: true });
        
        const snapshot = [
            { name: 'Alice', location: 'tavern', level: 5, ph: 'ab12cd34', ts: Date.now() }
        ];

        seedFromSnapshot(snapshot);

        expect(players.get('ghost:ab12cd34').location).toBe('cellar');
    });

    test('real presence overwrites ghost entry (simulated)', () => {
        players.set('ghost:ab12cd34', { name: 'Alice', ph: 'ab12cd34', location: 'cellar', ghost: true });
        
        // Simulating the logic in processPresenceSingle:
        // trackPlayer(peerId, ...)
        // players.delete('ghost:' + unpacked.ph)
        
        const peerId = 'peer1';
        const unpacked = { name: 'Alice', ph: 'ab12cd34', location: 'cellar' };
        
        trackPlayer(peerId, { ...unpacked, ts: Date.now() });
        players.delete('ghost:' + unpacked.ph);

        expect(players.has('ghost:ab12cd34')).toBe(false);
        expect(players.has('peer1')).toBe(true);
        expect(players.get('peer1').ghost).toBeFalsy();
    });
});

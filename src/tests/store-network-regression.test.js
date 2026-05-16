import { _presenceDelta, clearPresenceDelta, players, trackPlayer } from '../state/store.js';

describe('network regression guards in store', () => {
    beforeEach(() => {
        players.clear();
        clearPresenceDelta();
    });

    test('ghost snapshot entries do not emit joined deltas', () => {
        trackPlayer('ghost:abcd1234', {
            name: 'Ghost',
            ph: 'abcd1234',
            location: 'market',
            ghost: true,
        });

        expect(_presenceDelta.joined.has('ghost:abcd1234')).toBe(false);
    });

    test('real peers still emit joined deltas', () => {
        trackPlayer('peer-1', {
            name: 'Peer',
            ph: 'abcd1234',
            location: 'market',
        });

        expect(_presenceDelta.joined.has('peer-1')).toBe(true);
    });
});

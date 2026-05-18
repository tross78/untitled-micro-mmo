import { getSpriteKind } from '../graphics/sprite-kind.js';

describe('sprite kind classification', () => {
    test('resource prefixed palettes classify as resources', () => {
        expect(getSpriteKind({ palette: 'resource:log', type: 'log' })).toBe('resource');
        expect(getSpriteKind({ palette: 'resource:ore', type: 'ore' })).toBe('resource');
    });

    test('npc and enemy palettes still classify correctly', () => {
        expect(getSpriteKind({ palette: 'npcWarm', type: 'barkeep' })).toBe('npc');
        expect(getSpriteKind({ palette: 'enemy', type: 'wolf' })).toBe('enemy');
    });
});

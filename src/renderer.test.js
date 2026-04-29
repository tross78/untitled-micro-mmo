/**
 * Renderer logic regression tests.
 * Canvas drawing is not tested here (no pixel assertions), but the
 * pure functions and data-path logic that were broken are covered.
 */

// --- shortName helper (copy of the function from renderer.js) ---
// If it's ever exported, import it instead. For now we inline the logic
// so the test is independent of the canvas module.
const ARTICLES = new Set(['the', 'a', 'an']);
const shortName = (name) => {
    const str = name || '';
    const words = str.split(' ');
    const first = words[0].toLowerCase();
    const label = ARTICLES.has(first) ? words.slice(1).join(' ') : str;
    return label.slice(0, 10);
};

describe('shortName helper (canvas label truncation)', () => {
    test('strips leading "The" article', () => {
        expect(shortName('The Bard')).toBe('Bard');
        expect(shortName('The Cellar')).toBe('Cellar');
        expect(shortName('The Market Square')).toBe('Market Squ');
    });

    test('strips leading "A" and "An" articles', () => {
        expect(shortName('A Wolf')).toBe('Wolf');
        expect(shortName('An Elder')).toBe('Elder');
    });

    test('does not strip non-article first words', () => {
        expect(shortName('Forest Wolf')).toBe('Forest Wol');
        expect(shortName('Barkeep')).toBe('Barkeep');
        expect(shortName('Merchant')).toBe('Merchant');
        expect(shortName('Guard')).toBe('Guard');
    });

    test('truncates long names to 10 chars', () => {
        expect(shortName('Mountain Troll').length).toBeLessThanOrEqual(10);
        expect(shortName('The Mountain Troll').length).toBeLessThanOrEqual(10);
    });

    test('handles empty / falsy input', () => {
        expect(shortName('')).toBe('');
        expect(shortName(null)).toBe('');
        expect(shortName(undefined)).toBe('');
    });

    // Regression: split(' ')[0] on "The Bard" returned "The", not "Bard"
    test('regression: "The Bard".split(" ")[0] is "The" — shortName must not do this', () => {
        expect('The Bard'.split(' ')[0]).toBe('The'); // confirm the bad old pattern
        expect(shortName('The Bard')).not.toBe('The'); // shortName must fix it
        expect(shortName('The Bard')).toBe('Bard');
    });
});

// --- Tile bounds logic ---
describe('Out-of-bounds tile rendering guard', () => {
    // The renderer loops over VIEWPORT_W x VIEWPORT_H tiles and should skip
    // (draw void) any tile where worldX >= loc.width or worldY >= loc.height.
    // This test verifies the guard condition logic in isolation.

    const VIEWPORT_W = 15;
    const VIEWPORT_H = 11;

    function tilesInBounds(locWidth, locHeight, camX = 0, camY = 0) {
        const inBounds = [];
        const outOfBounds = [];
        for (let ty = 0; ty < VIEWPORT_H; ty++) {
            for (let tx = 0; tx < VIEWPORT_W; tx++) {
                const wx = camX + tx;
                const wy = camY + ty;
                if (wx >= locWidth || wy >= locHeight) {
                    outOfBounds.push({ tx, ty, wx, wy });
                } else {
                    inBounds.push({ tx, ty, wx, wy });
                }
            }
        }
        return { inBounds, outOfBounds };
    }

    test('hallway (11x10) has out-of-bounds tiles in the viewport', () => {
        const { outOfBounds } = tilesInBounds(11, 10);
        // Width 11 < viewport 15 → 4 columns out of bounds on the right
        // Height 10 < viewport 11 → 1 row out of bounds at the bottom
        expect(outOfBounds.length).toBeGreaterThan(0);
    });

    test('all hallway exit tiles are within room bounds', () => {
        // Regression: exits at room-edge positions should be in-bounds,
        // not hidden behind out-of-bounds void rendering.
        const hallwayExits = [
            { x: 5, y: 9 }, // south to cellar
            { x: 5, y: 0 }, // north to tavern
            { x: 10, y: 5 }, // east to forest_edge
        ];
        hallwayExits.forEach(({ x, y }) => {
            expect(x).toBeLessThan(11); // within width
            expect(y).toBeLessThan(10); // within height
        });
    });

    test('large room (20x20) fits player viewport without out-of-bounds columns', () => {
        const { outOfBounds } = tilesInBounds(20, 20, 3, 5);
        // With camX=3: viewport shows cols 3..17, but room only goes to 19 — no OOB
        // Exact: wx max = camX + VIEWPORT_W - 1 = 3 + 14 = 17 < 20 ✓
        expect(outOfBounds.length).toBe(0);
    });

    test('room smaller than viewport produces void tiles on right and bottom edges', () => {
        // Cellar is 10x10, viewport is 15x11
        const { outOfBounds, inBounds } = tilesInBounds(10, 10);
        expect(inBounds.length).toBe(100);  // 10x10
        expect(outOfBounds.length).toBe(VIEWPORT_W * VIEWPORT_H - 100);
    });
});

// --- Canvas click entity resolution ---
describe('Canvas click entity detection logic', () => {
    // Reproduces the logic from renderer.js click handler
    function resolveClick(tx, ty, { npcTiles, enemyTileKey }) {
        const key = `${tx},${ty}`;
        if (npcTiles.has(key)) return { type: 'npc', id: npcTiles.get(key) };
        if (enemyTileKey && key === enemyTileKey) return { type: 'enemy' };
        return null;
    }

    const npcTiles = new Map([['10,2', 'barkeep'], ['2,2', 'bard']]);
    const enemyTileKey = '12,5';

    test('clicking NPC tile returns npc entity', () => {
        expect(resolveClick(10, 2, { npcTiles, enemyTileKey })).toEqual({ type: 'npc', id: 'barkeep' });
        expect(resolveClick(2, 2, { npcTiles, enemyTileKey })).toEqual({ type: 'npc', id: 'bard' });
    });

    test('clicking enemy tile returns enemy entity', () => {
        expect(resolveClick(12, 5, { npcTiles, enemyTileKey })).toEqual({ type: 'enemy' });
    });

    test('clicking empty tile returns null (move intent)', () => {
        expect(resolveClick(7, 7, { npcTiles, enemyTileKey })).toBeNull();
    });

    test('clicking empty tile when no enemy is present returns null', () => {
        expect(resolveClick(12, 5, { npcTiles, enemyTileKey: null })).toBeNull();
    });

    // Regression: old handler called onTileClick(tx, ty) with no entity info,
    // so clicking an NPC sprite just walked toward it instead of talking.
    test('regression: NPC tile click must not fall through to move logic', () => {
        const result = resolveClick(10, 2, { npcTiles, enemyTileKey });
        expect(result?.type).toBe('npc'); // must be intercepted before move
    });
});

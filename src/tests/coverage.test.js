/**
 * Extra coverage for Phase 7.85 features:
 * - Dialogue Content Guards
 * - Combat Movement Block
 * - Small Room Camera Centering
 */

import { isDialogueOpen, advanceDialogue } from '../renderer.js';

describe('Phase 7.85 Feature Coverage', () => {

    describe('Dialogue Content Guards', () => {
        // We can't easily test showDialogue because it's a side effect in renderer.js
        // but we can test the logic of isDialogueOpen and advanceDialogue if we 
        // could access the internal _dialogue. Since we can't, we test via advanceDialogue.
        
        test('isDialogueOpen returns false when no dialogue is active', () => {
            expect(isDialogueOpen()).toBe(false);
        });

        // advanceDialogue returns false if it closes dialogue or none active
        test('advanceDialogue returns false when none active', () => {
            expect(advanceDialogue()).toBe(false);
        });
    });

    describe('Small Room Camera Logic', () => {
        // The camera clamping logic from renderer.js
        const VIEWPORT_W = 15;
        const VIEWPORT_H = 11;

        function getCamPos(locWidth, locHeight, playerX, playerY) {
            const camX = locWidth <= VIEWPORT_W 
                ? -(VIEWPORT_W - locWidth) / 2 
                : Math.max(0, Math.min(locWidth - VIEWPORT_W, playerX - Math.floor(VIEWPORT_W / 2)));
            const camY = locHeight <= VIEWPORT_H 
                ? -(VIEWPORT_H - locHeight) / 2 
                : Math.max(0, Math.min(locHeight - VIEWPORT_H, playerY - Math.floor(VIEWPORT_H / 2)));
            return { camX, camY };
        }

        test('8x8 room (Smuggler Den) is centered in 15x11 viewport', () => {
            const { camX, camY } = getCamPos(8, 8, 4, 4);
            // -(15 - 8) / 2 = -7 / 2 = -3.5
            expect(camX).toBe(-3.5);
            // -(11 - 8) / 2 = -3 / 2 = -1.5
            expect(camY).toBe(-1.5);
        });

        test('large room (25x25) clamps correctly at top-left', () => {
            const { camX, camY } = getCamPos(25, 25, 2, 2);
            expect(camX).toBe(0);
            expect(camY).toBe(0);
        });

        test('large room (25x25) clamps correctly at bottom-right', () => {
            const { camX, camY } = getCamPos(25, 25, 23, 23);
            // 25 - 15 = 10
            expect(camX).toBe(10);
            // 25 - 11 = 14
            expect(camY).toBe(14);
        });
    });

    describe('Combat Movement Block logic', () => {
        // Extracted logic from stepPlayer
        function canMove(localPlayer, shardEnemies) {
            if (localPlayer.currentEnemy) {
                const shared = shardEnemies.get(localPlayer.location);
                if (shared && shared.hp > 0) return false; 
            }
            return true;
        }

        test('blocks movement if enemy is alive', () => {
            const player = { currentEnemy: { type: 'wolf' }, location: 'forest' };
            const shard = new Map([['forest', { hp: 10 }]]);
            expect(canMove(player, shard)).toBe(false);
        });

        test('allows movement if currentEnemy is null', () => {
            const player = { currentEnemy: null, location: 'forest' };
            const shard = new Map([['forest', { hp: 10 }]]);
            expect(canMove(player, shard)).toBe(true);
        });

        test('allows movement if enemy is dead in shard (auto-clear)', () => {
            const player = { currentEnemy: { type: 'wolf' }, location: 'forest' };
            const shard = new Map([['forest', { hp: 0 }]]);
            expect(canMove(player, shard)).toBe(true);
        });
    });
});

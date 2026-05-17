import { world } from '../content/data.js';

export const getShardName = (loc, inst) => `${loc}-${inst}`;

export function validateMove(currentLocation, direction) {
    return world[currentLocation]?.exits[direction] || null;
}

/**
 * Deterministic BFS/spiral search for nearest walkable tile.
 * Used by both runtime and validation.
 * @param {number} tx - Target X
 * @param {number} ty - Target Y
 * @param {number} width - Room width
 * @param {number} height - Room height
 * @param {(x: number, y: number) => boolean} isWalkable - Predicate
 */
export function findSafeArrival(tx, ty, width, height, isWalkable) {
    if (isWalkable(tx, ty)) return { x: tx, y: ty };

    // Spiral outward up to distance 3
    const queue = [{ x: tx, y: ty, d: 0 }];
    const visited = new Set([`${tx},${ty}`]);
    let head = 0;

    while (head < queue.length) {
        const curr = queue[head++];
        if (curr.d >= 3) break;

        // Stable neighbor order: N, S, E, W, NE, NW, SE, SW
        const neighbors = [
            { x: curr.x, y: curr.y - 1 }, { x: curr.x, y: curr.y + 1 },
            { x: curr.x + 1, y: curr.y }, { x: curr.x - 1, y: curr.y },
            { x: curr.x + 1, y: curr.y - 1 }, { x: curr.x - 1, y: curr.y - 1 },
            { x: curr.x + 1, y: curr.y + 1 }, { x: curr.x - 1, y: curr.y + 1 }
        ];

        for (const n of neighbors) {
            if (n.x < 0 || n.x >= width || n.y < 0 || n.y >= height) continue;
            const key = `${n.x},${n.y}`;
            if (visited.has(key)) continue;
            visited.add(key);

            if (isWalkable(n.x, n.y)) return n;
            queue.push({ ...n, d: curr.d + 1 });
        }
    }

    // Fallback: try room center
    const cx = Math.floor(width / 2);
    const cy = Math.floor(height / 2);
    if (isWalkable(cx, cy)) return { x: cx, y: cy };

    return null; // Absolute failure
}

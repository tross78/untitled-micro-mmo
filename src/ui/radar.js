import { hashStr } from '../rules.js';

const radarEl = document.getElementById('radar-container');

export const drawRadar = (ctx, onTileClick) => {
    if (!radarEl) return;
    const { localPlayer, world, players, shardEnemies, NPCS, getNPCLocation, worldState } = ctx;
    const loc = world[localPlayer.location];
    if (!loc) return;
    radarEl.innerHTML = '';
    radarEl.style.gridTemplateColumns = `repeat(${loc.width}, 1fr)`;
    radarEl.style.gridTemplateRows = `repeat(${loc.height}, 1fr)`;
    const grid = Array.from({ length: loc.height }, () => Array(loc.width).fill(null));
    (loc.scenery || []).forEach(s => {
        if (s.x < loc.width && s.y < loc.height) grid[s.y][s.x] = { type: 'scenery', label: s.label || 'B' };
    });
    (loc.exitTiles || []).forEach(p => {
        if (p.x < loc.width && p.y < loc.height) grid[p.y][p.x] = { type: 'exit', label: '▸' };
    });
    const sharedEnemy = shardEnemies.get(localPlayer.location);
    if ((sharedEnemy && sharedEnemy.hp > 0) || (loc.enemy && !sharedEnemy)) {
        const ex = loc.enemyX ?? Math.floor(loc.width / 2);
        const ey = loc.enemyY ?? Math.floor(loc.height / 2);
        if (ex < loc.width && ey < loc.height) grid[ey][ex] = { type: 'enemy', label: 'E' };
    }
    if (worldState.seed) Object.keys(NPCS || {}).forEach(id => {
        if (getNPCLocation(id, worldState.seed, worldState.day) === localPlayer.location) {
            const staticNpc = (loc.staticEntities || []).find(e => e.id === id);
            let nx, ny;
            if (staticNpc) { nx = staticNpc.x; ny = staticNpc.y; }
            else {
                const hash = hashStr(id + localPlayer.location);
                nx = (hash % Math.max(1, loc.width - 2)) + 1;
                ny = ((hash >> 4) % Math.max(1, loc.height - 2)) + 1;
            }
            if (nx < loc.width && ny < loc.height) grid[ny][nx] = { type: 'npc', label: 'N' };
        }
    });
    players.forEach((p, _id) => {
        if (!p.ghost && p.location === localPlayer.location && p.x !== undefined) {
            if (p.x < loc.width && p.y < loc.height) grid[p.y][p.x] = { type: 'peer', label: 'P' };
        }
    });
    if (localPlayer.x < loc.width && localPlayer.y < loc.height) grid[localPlayer.y][localPlayer.x] = { type: 'self', label: '@' };
    for (let y = 0; y < loc.height; y++) {
        for (let x = 0; x < loc.width; x++) {
            const tile = document.createElement('div');
            tile.className = 'tile';
            const entity = grid[y][x];
            if (entity) {
                tile.textContent = entity.label;
                tile.classList.add(`entity-${entity.type}`);
                if (entity.type === 'scenery') tile.style.opacity = '0.4';
            } else { tile.textContent = '·'; }
            tile.addEventListener('click', () => onTileClick(x, y));
            radarEl.appendChild(tile);
        }
    }
};

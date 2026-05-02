import { localPlayer, shardEnemies } from '../state/store.js';
import { world, QUESTS } from '../engine/data.js';
import { saveLocalState } from '../state/persistence.js';
import { gameActions, joinInstance, currentInstance, currentRtcConfig, preJoinShard } from '../network/index.js';
import { myEntry } from '../security/identity.js';
import { bus } from '../state/eventbus.js';
import { xpToLevel } from '../rules/index.js';
import { grantItem } from '../commands/index.js';

let isMoving = false;

export const stepPlayer = async (stepX, stepY, triggerLogicalRefresh) => {
    if (isMoving) return;

    if (localPlayer.currentEnemy) {
        const shared = shardEnemies.get(localPlayer.location);
        if (shared && shared.hp > 0) return;
        localPlayer.currentEnemy = null;
    }

    isMoving = true;
    
    try {
        const loc = world[localPlayer.location];
        const nextX = localPlayer.x + stepX;
        const nextY = localPlayer.y + stepY;

        const px = localPlayer.x, py = localPlayer.y;
        for (const tile of (loc.exitTiles || [])) {
            if (Math.abs(tile.x - px) + Math.abs(tile.y - py) <= 2) preJoinShard(tile.dest);
        }
        const exits = loc.exits || {};
        if (px <= 1 && exits.west) preJoinShard(exits.west);
        if (px >= loc.width - 2 && exits.east) preJoinShard(exits.east);
        if (py <= 1 && exits.north) preJoinShard(exits.north);
        if (py >= loc.height - 2 && exits.south) preJoinShard(exits.south);

        const outOfBounds = nextX < 0 || nextX >= loc.width || nextY < 0 || nextY >= loc.height;

        if (!outOfBounds) {
            localPlayer.x = nextX;
            localPlayer.y = nextY;
            saveLocalState(localPlayer);
            if (gameActions.sendMove) gameActions.sendMove({ from: localPlayer.location, to: localPlayer.location, x: nextX, y: nextY });

            const exit = ( loc.exitTiles || []).find(p => p.x === nextX && p.y === nextY);
            if (exit) {
                const prevLoc = localPlayer.location;
                localPlayer.location = exit.dest;
                localPlayer.x = exit.destX ?? 5;
                localPlayer.y = exit.destY ?? 5;
                saveLocalState(localPlayer);
                
                await joinInstance(exit.dest, currentInstance, currentRtcConfig);
                
                const entry = await myEntry();
                if (entry && gameActions.sendPresenceSingle) gameActions.sendPresenceSingle(entry);
                if (gameActions.sendMove) gameActions.sendMove({ from: prevLoc, to: exit.dest, x: localPlayer.x, y: localPlayer.y });
                
                bus.emit('player:move', { from: prevLoc, to: exit.dest });
                triggerLogicalRefresh();
                return;
            }
            triggerLogicalRefresh();
            return;
        }

        const dirMap = [
            { sx: 0, sy: -1, dir: 'north' }, { sx: 0, sy: 1, dir: 'south' },
            { sx: -1, sy: 0, dir: 'west' },  { sx: 1, sy: 0, dir: 'east' },
            { sx: 0, sy: -1, dir: 'up' },    { sx: 0, sy: 1, dir: 'down' },
        ];
        const match = dirMap.find(d => d.sx === stepX && d.sy === stepY);
        const destId = match && loc.exits?.[match.dir];
        if (!destId || !world[destId]) return;

        const entryExit = ( loc.exitTiles || []).find(p => p.dest === destId);
        const prevLoc = localPlayer.location;
        localPlayer.location = destId;
        localPlayer.x = entryExit?.destX ?? Math.floor(world[destId].width / 2);
        localPlayer.y = entryExit?.destY ?? Math.floor(world[destId].height / 2);
        saveLocalState(localPlayer);
        
        await joinInstance(destId, currentInstance, currentRtcConfig);
        
        const entry = await myEntry();
        if (entry && gameActions.sendPresenceSingle) gameActions.sendPresenceSingle(entry);
        if (gameActions.sendMove) gameActions.sendMove({ from: prevLoc, to: destId, x: localPlayer.x, y: localPlayer.y });
        
        bus.emit('player:move', { from: prevLoc, to: destId });
        triggerLogicalRefresh();
    } finally {
        setTimeout(() => { isMoving = false; }, 150);
    }
};

import { selfId } from '../network/transport.js';
import { localPlayer, worldState, players, hasSyncedWithArbiter } from '../state/store.js';
import { globalRooms, rooms } from '../network/index.js';
import { isDialogueOpen } from '../graphics/renderer.js';
import { getOutputEl } from '../adapters/dom/shell.js';

export const buildTestSnapshot = () => ({
    selfId,
    localPlayer: {
        name: localPlayer.name,
        location: localPlayer.location,
        x: localPlayer.x,
        y: localPlayer.y,
        hp: localPlayer.hp,
        xp: localPlayer.xp,
        level: localPlayer.level,
        gold: localPlayer.gold,
        ph: localPlayer.ph,
    },
    worldState: {
        seed: worldState.seed,
        day: worldState.day,
        mood: worldState.mood,
    },
    peers: Array.from(players.entries()).map(([id, entry]) => ({
        id,
        name: entry.name,
        location: entry.location,
        x: entry.x,
        y: entry.y,
        ph: entry.ph,
        ghost: !!entry.ghost,
        hasPublicKey: !!entry.publicKey,
    })),
    network: {
        globalPeers: globalRooms.torrent ? Object.keys(globalRooms.torrent.getPeers()).length : 0,
        shardPeers: rooms.torrent ? Object.keys(rooms.torrent.getPeers()).length : 0,
        synced: hasSyncedWithArbiter,
    },
    dialogueOpen: isDialogueOpen(),
    outputText: getOutputEl()?.textContent || '',
});

import { localPlayer, worldState, players, shardEnemies, pendingDuel, pendingTrade, hasSyncedWithArbiter, setPendingDuel, setPendingTrade } from '../store.js';
import { world, NPCS, ENEMIES, ITEMS, QUESTS, GAME_NAME } from '../data.js';
import { getNPCLocation, getTimeOfDay } from '../rules.js';
import { renderWorld, setVisualRefreshCallback, setLogicalRefreshCallback, triggerHitFlash, showFloatingText, showDialogue, showToast, playHit, playCrit, playDeath, playPickup, playLevelUp, showLevelUp, showItemFanfare, playPortal, showRoomBanner } from '../renderer.js';
import { renderActionButtons, log } from '../ui.js';
import { ACTION, inputManager } from '../input.js';
import { handleCommand, getPlayerName, startStateChannel, resolveRound, grantItem } from '../commands.js';
import { bus } from '../eventbus.js';
import { stepPlayer } from './movement.js';
import { gameActions, saveLocalState } from '../networking.js';
import { importKey, verifyMessage } from '../crypto.js';
import { selfId } from '../transport.js';

let _vRefreshTimer = null;
export const triggerVisualRefresh = () => {
    if (_vRefreshTimer) return;
    _vRefreshTimer = requestAnimationFrame(() => {
        _vRefreshTimer = null;
        const ctx = {
            localPlayer, world, NPCS, worldState, getNPCLocation, ENEMIES, ITEMS, QUESTS, pendingDuel, pendingTrade, players, shardEnemies
        };
        renderWorld(ctx, (tx, ty, entity) => {
            const loc = world[localPlayer.location];
            if (tx < 0 || tx >= loc.width || ty < 0 || ty >= loc.height) return;
            if (entity?.type === 'npc') { handleCommand(`talk ${entity.id}`).then(triggerLogicalRefresh); return; }
            if (entity?.type === 'enemy') { handleCommand('attack').then(triggerLogicalRefresh); return; }
            const dx = tx - localPlayer.x;
            const dy = ty - localPlayer.y;
            if (dx === 0 && dy === 0) return;
            const stepX = dx !== 0 ? (dx > 0 ? 1 : -1) : 0;
            const stepY = stepX === 0 && dy !== 0 ? (dy > 0 ? 1 : -1) : 0;
            stepPlayer(stepX, stepY, triggerLogicalRefresh);
        });
    });
};

let _lRefreshTimer = null;
export const triggerLogicalRefresh = () => {
    if (_lRefreshTimer) return;
    _lRefreshTimer = setTimeout(() => {
        _lRefreshTimer = null;
        const ctx = {
            localPlayer, world, NPCS, worldState, getNPCLocation, ENEMIES, ITEMS, QUESTS, pendingDuel, pendingTrade, players, shardEnemies
        };
        renderActionButtons(ctx, (cmdOrAction) => {
            const ACTION_VALUES = new Set(Object.values(ACTION));
            if (ACTION_VALUES.has(cmdOrAction)) {
                bus.emit('input:action', { action: cmdOrAction, type: 'down' });
            } else if (cmdOrAction === 'help-keys') {
                log(`\n--- Keyboard Shortcuts ---`, '#aaa');
                log(`WASD / Arrows — Move one tile`, '#aaa');
                log(`Space / E — Interact (talk / use exit)`, '#aaa');
                log(`F / Z — Attack`, '#aaa');
                log(`I / Tab — Inventory`, '#aaa');
                log(`Escape — Back / Cancel`, '#aaa');
                log(`\` (backtick) — Toggle radar view`, '#aaa');
                log(`~ (tilde) — Toggle log panel`, '#aaa');
                log(`--------------------------\n`, '#aaa');
            } else {
                handleCommand(cmdOrAction).then(triggerLogicalRefresh);
            }
        });
        triggerVisualRefresh();
    }, 50);
};

export const setupGlobalEvents = () => {
    setVisualRefreshCallback(triggerVisualRefresh);
    setLogicalRefreshCallback(triggerLogicalRefresh);

    bus.on('combat:hit', ({ _attacker, crit }) => {
        if (crit) playCrit(); else playHit();
        triggerHitFlash();
    });
    bus.on('combat:dodge', ({ target }) => {
        if (target === 'You') {
            showFloatingText(localPlayer.x, localPlayer.y, 'DODGE', '#0fa');
        } else {
            const loc = world[localPlayer.location];
            const ex = loc.enemyX ?? Math.floor(loc.width / 2);
            const ey = loc.enemyY ?? Math.floor(loc.height / 2);
            showFloatingText(ex, ey, 'MISS', '#fff');
        }
    });
    bus.on('combat:death', ({ entity }) => {
        if (entity === 'You') playDeath();
        else playPickup();
    });
    bus.on('player:levelup', ({ level }) => {
        playLevelUp();
        showLevelUp(level);
    });
    bus.on('item:pickup', ({ item }) => {
        playPickup();
        if (item?.name) showItemFanfare(item.name);
    });
    bus.on('player:move', ({ to, from }) => {
        if (to !== from) {
            playPortal();
            const roomName = world[to]?.name;
            if (roomName) showRoomBanner(roomName);
        }
    });
    bus.on('npc:speak', ({ npcName, text }) => {
        showDialogue(npcName, text);
    });

    bus.on('log', ({ msg }) => {
        const cleanMsg = msg.replace(/<[^>]*>?/gm, '');
        showToast(cleanMsg);
    });

    bus.on('input:action', ({ action, type }) => {
        if (type !== 'down') return;
        const STEP = {
            [ACTION.MOVE_N]: [0, -1], [ACTION.MOVE_S]: [0, 1],
            [ACTION.MOVE_E]: [1, 0],  [ACTION.MOVE_W]: [-1, 0],
        };
        if (STEP[action]) { stepPlayer(...STEP[action], triggerLogicalRefresh); return; }

        let cmd = null;
        switch (action) {
            case ACTION.ATTACK: cmd = 'attack'; break;
            case ACTION.INTERACT: cmd = 'interact'; break;
            case ACTION.INVENTORY: cmd = 'inventory'; break;
            case ACTION.CANCEL: cmd = 'back'; break;
            case ACTION.CONFIRM: cmd = 'confirm'; break;
            case ACTION.MENU: cmd = 'status'; break;
        }
        if (cmd) {
            if (cmd === 'back') {
                bus.emit('ui:back', {});
                triggerLogicalRefresh();
            } else {
                handleCommand(cmd).then(triggerLogicalRefresh);
            }
        }
    });
    
    // --- P2P Network Events ---
    bus.on('duel:start', ({ targetId, targetName, day }) => {
        startStateChannel(targetId, targetName, day).then(triggerLogicalRefresh);
    });

    bus.on('duel:commit-received', ({ targetId }) => {
        resolveRound(targetId).then(triggerLogicalRefresh);
    });

    let tradeTimeout = null;
    const startTradeTimeout = () => {
        clearTimeout(tradeTimeout);
        tradeTimeout = setTimeout(() => {
            if (pendingTrade) {
                log(`[Trade] Session timed out.`, '#555');
                setPendingTrade(null);
                triggerLogicalRefresh();
            }
        }, 30000);
    };

    bus.on('trade:offer-received', ({ partnerId, partnerName, offer }) => {
        if (!pendingTrade || pendingTrade.partnerId !== partnerId) {
            setPendingTrade({
                partnerId,
                partnerName,
                partnerOffer: offer,
                myOffer: { gold: 0, items: [] },
                ts: Date.now(),
                signatures: { me: null, partner: null }
            });
        } else {
            pendingTrade.partnerOffer = offer;
        }
        startTradeTimeout();
        triggerLogicalRefresh();
    });

    bus.on('trade:accept-received', ({ partnerId, offer }) => {
        if (pendingTrade && pendingTrade.partnerId === partnerId) {
            pendingTrade.partnerOffer = offer;
            startTradeTimeout();
            triggerLogicalRefresh();
        }
    });

    bus.on('duel:incoming', ({ challengerName }) => {
        showToast(`${challengerName} challenged you to a duel.`);
        triggerLogicalRefresh();
    });

    const finalizeTrade = () => {
        if (!pendingTrade) return;
        const pt = pendingTrade;
        log(`\n[Trade] TRADE FINALIZED! 🤝`, '#0f0');
        localPlayer.gold -= pt.myOffer.gold;
        pt.myOffer.items.forEach(id => {
            const idx = localPlayer.inventory.indexOf(id);
            if (idx !== -1) localPlayer.inventory.splice(idx, 1);
        });
        localPlayer.gold += pt.partnerOffer.gold;
        pt.partnerOffer.items.forEach(id => grantItem(id));
        const delta = {
            [selfId]: { gives_gold: pt.myOffer.gold, gives_items: pt.myOffer.items, gets_gold: pt.partnerOffer.gold, gets_items: pt.partnerOffer.items },
            [pt.partnerId]: { gives_gold: pt.partnerOffer.gold, gives_items: pt.partnerOffer.items, gets_gold: pt.myOffer.gold, gets_items: pt.myOffer.items }
        };
        gameActions.sendTradeFinal({ peerA: selfId, peerB: pt.partnerId, delta });
        setPendingTrade(null);
        saveLocalState(localPlayer, true);
        triggerLogicalRefresh();
    };

    bus.on('trade:commit-received', async ({ partnerId, commit }) => {
        if (pendingTrade && pendingTrade.partnerId === partnerId) {
            const entry = players.get(partnerId);
            if (!entry?.publicKey) return;
            try {
                const pubKey = await importKey(entry.publicKey, 'public');
                const sigData = JSON.stringify({ gold: commit.gold, items: commit.items, ts: commit.ts });
                if (await verifyMessage(sigData, commit.signature, pubKey)) {
                    pendingTrade.signatures.partner = commit.signature;
                    pendingTrade.partnerOffer = { gold: commit.gold, items: commit.items };
                    if (pendingTrade.signatures.me) finalizeTrade();
                    else startTradeTimeout();
                }
            } catch (err) { console.error('[Trade] Verification fail:', err); }
            triggerLogicalRefresh();
        }
    });

    bus.on('trade:initiated', startTradeTimeout);
    bus.on('monster:damaged', triggerLogicalRefresh);
    bus.on('quest:progress', ({ name, current, total }) => showToast(`${name}: ${current}/${total}`));
    bus.on('quest:complete', ({ name }) => showToast(`COMPLETED: ${name}! ✨`));
    bus.on('peer:move', ({ peerId, data }) => {
        const name = getPlayerName(peerId);
        if (data.from === data.to) { triggerLogicalRefresh(); return; }
        if (data.to === localPlayer.location) {
            const fromDir = Object.entries(world[data.to]?.exits || {}).find(([, dest]) => dest === data.from)?.[0];
            showToast(`${name} arrives${fromDir ? ' from ' + fromDir : ''}`);
            triggerLogicalRefresh();
        } else if (data.from === localPlayer.location) {
            const toDir = Object.entries(world[data.from]?.exits || {}).find(([, dest]) => dest === data.to)?.[0];
            showToast(`${name} leaves${toDir ? ' to ' + toDir : ''}`);
            triggerLogicalRefresh();
        }
    });
    bus.on('peer:emote', ({ peerId, data }) => showToast(`${getPlayerName(peerId)} ${data.text}`));
    bus.on('peer:leave', ({ peerId }) => { showToast(`${getPlayerName(peerId)} vanished`); triggerLogicalRefresh(); });
};

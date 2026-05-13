import { localPlayer, worldState, players, shardEnemies, pendingDuel, pendingTrade, setPendingTrade } from '../state/store.js';
import { world, NPCS, ENEMIES, ITEMS, QUESTS, RECIPES } from '../content/data.js';
import { getNPCLocation } from '../rules/index.js';
import { renderWorld, setVisualRefreshCallback, setLogicalRefreshCallback, triggerHitFlash, showFloatingText, showDialogue, showToast, showLevelUp, showItemFanfare, showRoomBanner, advanceDialogue, isDialogueOpen } from '../graphics/renderer.js';
import { log } from '../ui/index.js';
import { triggerShake } from '../ui/helpers.js';
import { ACTION } from '../engine/input.js';
import { handleCommand, getPlayerName, startStateChannel, resolveRound, grantItem } from '../commands/index.js';
import { bus } from '../state/eventbus.js';
import { appRuntime } from '../app/runtime.js';
import { Component } from '../domain/components.js';
import { gameActions } from '../network/index.js';
import { saveLocalState } from '../state/persistence.js';
import { importKey, verifyMessage } from '../security/crypto.js';
import { selfId } from '../network/transport.js';
import { buildCanvasMenu, findNearestEnabledIndex } from '../ui/canvas-menu.js';
import { getNPCsAt } from '../commands/helpers.js';
import { getTimeOfDay } from '../rules/index.js';
import { stepAudioVolume, toggleAudioMute } from '../engine/audio.js';

let _vRefreshTimer = null;
let _queuedMenuAfterDialogue = null;
let _globalEventsBound = false;
const getMenuCtx = () => ({
    localPlayer,
    world,
    worldState,
    getNPCsAt,
    getTimeOfDay,
});

const setMenuState = (menu) => {
    if (!appRuntime.playerEntityId) return;
    if (!menu) {
        appRuntime.world.removeComponent(appRuntime.playerEntityId, Component.Menu);
        return;
    }
    appRuntime.world.setComponent(appRuntime.playerEntityId, Component.Menu, menu);
};

const rebuildMenu = (menuType, context = {}, parent = null, selectedIndex = 0) => {
    const menu = buildCanvasMenu(menuType, context, getMenuCtx());
    if (!menu) return null;
    menu.context = context;
    menu.parent = parent;
    menu.selectedIndex = Math.min(selectedIndex, Math.max(0, menu.entries.length - 1));
    if (menu.entries[menu.selectedIndex]?.disabled) {
        menu.selectedIndex = findNearestEnabledIndex(menu.entries, menu.selectedIndex, 1);
    }
    return menu;
};

const openMenu = (menuType, context = {}, parent = null, selectedIndex = 0) => {
    setMenuState(rebuildMenu(menuType, context, parent, selectedIndex));
    triggerLogicalRefresh();
};

const getOpenMenu = () => appRuntime.world.getComponent(appRuntime.playerEntityId, Component.Menu);

const closeMenu = () => {
    setMenuState(null);
    triggerLogicalRefresh();
};

const goBackMenu = () => {
    const menu = getOpenMenu();
    if (!menu?.parent) {
        closeMenu();
        return;
    }
    openMenu(menu.parent.type, menu.parent.context || {}, menu.parent.parent || null, menu.parent.selectedIndex || 0);
};

const activateMenuEntry = async (index = null) => {
    const menu = getOpenMenu();
    if (!menu || !menu.entries?.length) return false;
    const selectedIndex = index == null ? menu.selectedIndex || 0 : index;
    const entry = menu.entries[selectedIndex];
    if (!entry || entry.disabled || !entry.action) return false;

    if (entry.action.kind === 'menu') {
        openMenu(entry.action.menuType, entry.action.context || {}, {
            type: menu.type,
            context: menu.context || {},
            parent: menu.parent || null,
            selectedIndex,
        });
        return true;
    }
    if (entry.action.kind === 'back') {
        goBackMenu();
        return true;
    }
    if (entry.action.kind === 'close') {
        closeMenu();
        return true;
    }
    if (entry.action.kind === 'command') {
        await handleCommand(entry.action.command);
        if (isDialogueOpen()) {
            closeMenu();
        } else {
            const refreshed = rebuildMenu(menu.type, menu.context || {}, menu.parent || null, selectedIndex);
            if (refreshed) setMenuState(refreshed);
            else closeMenu();
        }
        triggerLogicalRefresh();
        return true;
    }
    if (entry.action.kind === 'emit') {
        bus.emit(entry.action.event, entry.action.payload || {});
        const refreshed = rebuildMenu(menu.type, menu.context || {}, menu.parent || null, selectedIndex);
        if (refreshed) setMenuState(refreshed);
        triggerLogicalRefresh();
        return true;
    }
    return false;
};

export const resetVisualRefreshTimer = () => { _vRefreshTimer = null; };

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
            if (entity?.type === 'self') {
                // tap self: no-op — use the Menu button to open the main menu
                return;
            }
            if (entity?.type === 'npc') { openMenu('npc', { npcId: entity.id }); return; }
            if (entity?.type === 'enemy') { handleCommand('attack').then(triggerLogicalRefresh); return; }
            
            // Ground tiles: set movement target (Phase 8.5a)
            if (appRuntime.playerEntityId) {
                appRuntime.world.setComponent(appRuntime.playerEntityId, Component.MovementTarget, { x: tx, y: ty });
                showToast(`→ (${tx}, ${ty})`);
                triggerLogicalRefresh();
            }
        });
    });
};

let _lRefreshTimer = null;
export const triggerLogicalRefresh = () => {
    if (_lRefreshTimer) return;
    _lRefreshTimer = setTimeout(() => {
        _lRefreshTimer = null;
        triggerVisualRefresh();
    }, 50);
};

export const setupGlobalEvents = () => {
    if (_globalEventsBound) return;
    _globalEventsBound = true;
    setVisualRefreshCallback(triggerVisualRefresh);
    setLogicalRefreshCallback(triggerLogicalRefresh);

    // Tilde (~) key toggle for debug console
    window.addEventListener('keydown', (e) => {
        const isInput = e.target instanceof HTMLElement && e.target.matches('input,textarea');
        if (e.key === '~' && !isInput) {
            const consoleEl = document.getElementById('debug-console');
            if (consoleEl) {
                consoleEl.classList.toggle('is-hidden');
            }
        }
    });

    bus.on('combat:hit', () => triggerHitFlash());
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
    bus.on('combat:death', () => {});
    bus.on('player:levelup', ({ level }) => showLevelUp(level));
    bus.on('item:pickup', ({ item }) => {
        if (item?.name) showItemFanfare(item.name);
    });
    bus.on('player:move', ({ to, from }) => {
        if (to !== from) {
            const room = world[to];
            if (room?.name) showRoomBanner(room.name);
            if (!localPlayer.visitedRooms) localPlayer.visitedRooms = [from];
            const isFirstVisit = !localPlayer.visitedRooms.includes(to);
            if (isFirstVisit) localPlayer.visitedRooms.push(to);

            // Season/mood flavor on room entry
            if (worldState.season && worldState.mood) {
                const seasonLine = `${worldState.season.charAt(0).toUpperCase() + worldState.season.slice(1)}, ${worldState.mood}. Day ${worldState.day}.`;
                log(seasonLine, '#556');
            }

            // Craft station hint — only on first visit to avoid spam
            const hasCraft = RECIPES.some(r => r.location === to);
            if (hasCraft && isFirstVisit) {
                log(`[Tip] This is a crafting station. Open the menu to see available recipes.`, '#aaa');
            }

            // 8.95i: hint locked exits so players know a key item exists
            const lockedExits = Object.values(world[to]?.exits || {}).filter(destId => {
                const keyItem = Object.values(ITEMS).find(it => it.unlocks === destId);
                if (!keyItem) return false;
                const keyId = Object.keys(ITEMS).find(id => ITEMS[id] === keyItem);
                return !localPlayer.inventory.includes(keyId);
            });
            lockedExits.forEach(destId => {
                const keyItem = Object.values(ITEMS).find(it => it.unlocks === destId);
                const keyId = Object.keys(ITEMS).find(id => ITEMS[id] === keyItem);
                log(`[Tip] ${world[destId]?.name || destId} is locked. You need a ${keyItem.name}.`, '#f80');
                const dropperNames = Object.values(ENEMIES)
                    .filter(e => e.loot?.includes(keyId))
                    .map(e => e.name);
                if (dropperNames.length > 0) log(`[Tip] ${keyItem.name} drops from: ${dropperNames.join(', ')}.`, '#888');
            });

            saveLocalState(localPlayer);
        }
        closeMenu();
        triggerLogicalRefresh();
    });
    bus.on('player:step', () => {
        triggerLogicalRefresh();
    });
    bus.on('npc:speak', ({ npcName, text }) => {
        showDialogue(npcName, text);
    });

    bus.on('ui:queue-menu', ({ type, context }) => {
        if (isDialogueOpen()) _queuedMenuAfterDialogue = { type, context: context || {} };
        else openMenu(type, context || {});
    });

    bus.on('dialogue:closed', () => {
        if (_queuedMenuAfterDialogue) {
            const queued = _queuedMenuAfterDialogue;
            _queuedMenuAfterDialogue = null;
            openMenu(queued.type, queued.context || {});
            return;
        }
        triggerLogicalRefresh();
    });

    bus.on('ui:back', () => {
        const menu = getOpenMenu();
        if (menu) {
            goBackMenu();
            return;
        }
        showDialogue(null, null);
    });
    
    bus.on('ui:menu', ({ type, context }) => {
        openMenu(type, context || {});
    });

    bus.on('ui:hud-action', ({ action, payload }) => {
        switch (action) {
            case 'menu': openMenu('root'); break;
            case 'inventory': {
                const existing = appRuntime.world.getComponent(appRuntime.playerEntityId, Component.Menu);
                if (existing?.type === 'inventory') closeMenu();
                else openMenu('inventory');
                break;
            }
            case 'quests': {
                const existing = appRuntime.world.getComponent(appRuntime.playerEntityId, Component.Menu);
                if (existing?.type === 'quests') closeMenu();
                else openMenu('quests');
                break;
            }
            case 'attack': handleCommand('attack').then(triggerLogicalRefresh); break;
            case 'flee': handleCommand('flee').then(triggerLogicalRefresh); break;
            case 'pickup': bus.emit('input:action', { action: ACTION.INTERACT, type: 'down' }); break;
            case 'npc': if (payload?.npcId) openMenu('npc', payload); break;
            case 'bank': handleCommand('bank').then(triggerLogicalRefresh); break;
        }
    });

    bus.on('ui:menu-select', ({ index }) => {
        activateMenuEntry(index);
    });

    bus.on('log', ({ msg }) => {
        const cleanMsg = msg.replace(/<[^>]*>?/gm, '');
        showToast(cleanMsg);
    });

    bus.on('ui:shake', () => triggerShake());

    bus.on('audio:toggle-mute', () => {
        toggleAudioMute();
        triggerLogicalRefresh();
    });

    bus.on('audio:change-volume', ({ field, delta }) => {
        stepAudioVolume(field, delta);
        triggerLogicalRefresh();
    });

    bus.on('input:action', ({ action, type }) => {
        if (type !== 'down') return;

        if (isDialogueOpen() && (action === ACTION.INTERACT || action === ACTION.CONFIRM || action === ACTION.CANCEL)) {
            if (action === ACTION.CANCEL) {
                bus.emit('ui:back', {});
            } else {
                advanceDialogue();
            }
            triggerLogicalRefresh();
            return;
        }

        const menu = getOpenMenu();
        if (menu) {
            if ([ACTION.MOVE_N, ACTION.MOVE_W].includes(action)) {
                menu.selectedIndex = findNearestEnabledIndex(menu.entries, menu.selectedIndex || 0, -1);
                triggerVisualRefresh();
                return;
            }
            if ([ACTION.MOVE_S, ACTION.MOVE_E].includes(action)) {
                menu.selectedIndex = findNearestEnabledIndex(menu.entries, menu.selectedIndex || 0, 1);
                triggerVisualRefresh();
                return;
            }
            if (action === ACTION.PAGE_UP || action === ACTION.PAGE_DOWN) {
                const delta = action === ACTION.PAGE_UP ? -1 : 1;
                let idx = menu.selectedIndex || 0;
                for (let i = 0; i < 5; i++) idx = findNearestEnabledIndex(menu.entries, idx, delta);
                menu.selectedIndex = idx;
                triggerVisualRefresh();
                return;
            }
            if (action === ACTION.CANCEL) {
                goBackMenu();
                return;
            }
            if ([ACTION.INTERACT, ACTION.CONFIRM, ACTION.ATTACK].includes(action)) {
                activateMenuEntry();
                return;
            }
        }
        
        // These are now handled by ECS Systems (InputSystem -> Movement/CombatSystem)
        const ECS_ACTIONS = new Set([
            ACTION.MOVE_N, ACTION.MOVE_S, ACTION.MOVE_E, ACTION.MOVE_W,
            ACTION.ATTACK, ACTION.INTERACT
        ]);
        if (ECS_ACTIONS.has(action)) return;

        let cmd = null;
        switch (action) {
            case ACTION.INVENTORY: {
                const existing = appRuntime.world.getComponent(appRuntime.playerEntityId, Component.Menu);
                if (existing && existing.type === 'inventory') {
                    closeMenu();
                } else {
                    openMenu('inventory');
                }
                return;
            }
            case ACTION.CANCEL: {
                const open = getOpenMenu();
                if (open) {
                    goBackMenu();
                    return;
                }
                cmd = 'back'; 
                break;
            }
            case ACTION.CONFIRM: return; // no-op; menus handle confirm via their own input path
            case ACTION.QUESTS: {
                const existing = appRuntime.world.getComponent(appRuntime.playerEntityId, Component.Menu);
                if (existing?.type === 'quests') closeMenu();
                else openMenu('quests');
                return;
            }
            case ACTION.MENU:
                openMenu('root');
                return;
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
    bus.on('world:event', ({ event }) => {
        const eventLabels = {
            market_surplus: 'Market Surplus',
            scarcity_spike: 'Scarcity Spike',
            bounty_hunt: 'Bounty Hunt',
            wandering_trader: 'Wandering Trader',
            wolf_pack: 'Wolf Pack',
            ancient_tremor: 'Ancient Tremor',
            wandering_boss: 'Wandering Boss',
        };
        const label = eventLabels[event?.type];
        if (label) showToast(label);
        triggerLogicalRefresh();
        triggerVisualRefresh();
    });
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
    bus.on('peer:leave', ({ peerId }) => { showToast(`${getPlayerName(peerId)} vanished`); triggerLogicalRefresh(); });
};

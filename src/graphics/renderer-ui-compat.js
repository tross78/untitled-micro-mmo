// @ts-check

import { appRuntime } from '../app/runtime.js';
import { Component } from '../domain/components.js';

/**
 * Temporary compatibility layer for legacy UI functions that haven't 
 * been fully moved into ECS components yet.
 */

let _hitFlash = 0;
let _tickerText = '';
let _banner = null;
let _triggerVisualRefresh = null;
let _triggerLogicalRefresh = null;

export function setVisualRefreshCallback(fn) { _triggerVisualRefresh = fn; }
export function setLogicalRefreshCallback(fn) { _triggerLogicalRefresh = fn; }

export function showDialogue(npcName, text) {
    if (!text) {
        appRuntime.world.components.get(Component.Dialogue)?.delete(appRuntime.playerEntityId);
        return;
    }

    appRuntime.world.setComponent(appRuntime.playerEntityId, Component.Dialogue, {
        speakerId: npcName,
        text,
        progress: 0,
        page: 0
    });
    
    if (_triggerVisualRefresh) _triggerVisualRefresh();
    if (_triggerLogicalRefresh) _triggerLogicalRefresh();
}

export function advanceDialogue() {
    const players = appRuntime.world.query([Component.Dialogue]);
    if (players.length === 0) return false;

    const dialogue = appRuntime.world.getComponent(players[0], Component.Dialogue);
    const isFinished = dialogue.progress >= dialogue.text.length;

    if (isFinished) {
        appRuntime.world.components.get(Component.Dialogue).delete(players[0]);
        if (_triggerVisualRefresh) _triggerVisualRefresh();
        if (_triggerLogicalRefresh) _triggerLogicalRefresh();
        return false;
    }
    
    // Otherwise, fast-forward typing
    dialogue.progress = dialogue.text.length;
    if (_triggerVisualRefresh) _triggerVisualRefresh();
    return true;
}

export function isDialogueOpen() {
    return appRuntime.world.query([Component.Dialogue]).length > 0;
}

export function getTickerText() {
    return _tickerText;
}

export function triggerHitFlash() { 
    _hitFlash = Date.now() + 200; 
    if (_triggerVisualRefresh) _triggerVisualRefresh();
}
export function setTicker(text) { 
    _tickerText = text; 
    if (_triggerVisualRefresh) _triggerVisualRefresh();
}
export function showRoomBanner(text) { 
    const id = appRuntime.world.createEntity();
    appRuntime.world.setComponent(id, Component.UIOverlay, {
        type: 'banner',
        text,
        expires: Date.now() + 2000
    });
    if (_triggerVisualRefresh) _triggerVisualRefresh();
}

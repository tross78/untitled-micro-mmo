// @ts-check

import { appRuntime } from '../app/runtime.js';
import { getGameAreaEl, getShellElement } from '../adapters/dom/shell.js';
import { Component } from '../domain/components.js';

let _canvas = null;
let _ctx = null;
let _radarEl = null;
let _devMode = false;

export function initCanvas() {
    if (_canvas) return;
    _radarEl = getShellElement('radar-container');
    const container = getGameAreaEl();

    _canvas = document.createElement('canvas');
    _canvas.id = 'game-canvas';
    _canvas.className = 'game-canvas';
    
    // Initial size from appRuntime config or defaults
    _canvas.width = 960; // 20 * 48
    _canvas.height = 576; // 12 * 48

    _ctx = _canvas.getContext('2d');
    if (_ctx) _ctx.imageSmoothingEnabled = false;

    if (container) {
        container.appendChild(_canvas);
        const ro = new ResizeObserver(() => {
            const scale = Math.min((container.clientWidth - 4) / _canvas.width, (container.clientHeight - 4) / _canvas.height);
            _canvas.style.transform = `scale(${scale})`;
            _canvas.style.transformOrigin = 'center';
            _canvas.style.margin = '0';
        });
        ro.observe(container);
    }

    // Dev Key Toggle
    window.addEventListener('keydown', (e) => {
        if (e.key === '`' && !e.target.matches('input,textarea')) {
            toggleDevRadar();
        }
    });
}

export function toggleDevRadar() {
    _devMode = !_devMode;
    if (_canvas) _canvas.style.display = _devMode ? 'none' : 'block';
    if (_radarEl) _radarEl.style.display = _devMode ? 'grid' : 'none';
}

/**
 * Legacy entry point - now delegates to appRuntime systems.
 */
export function renderWorld(state, onTileClick) {
    initCanvas();
    if (_devMode) {
        import('../ui/index.js').then(({ drawRadar }) => {
            drawRadar(state, onTileClick);
        });
        return;
    }
    
    // In modular Phase 8, the GameLoop in appRuntime handles the calling of draw().
    // We just ensure the click handler is wired to the current camera.
    _canvas.onclick = (e) => {
        const transform = appRuntime.world.getComponent(appRuntime.playerEntityId, Component.Transform);
        const tween = appRuntime.world.getComponent(appRuntime.playerEntityId, Component.Tweenable);
        if (!transform) return;

        let drawX = transform.x;
        let drawY = transform.y;
        if (tween) {
            drawX = tween.startX + (tween.targetX - tween.startX) * tween.progress;
            drawY = tween.startY + (tween.targetY - tween.startY) * tween.progress;
        }

        // Camera follow (same logic as AppRuntime.draw)
        const camX = drawX - 10;
        const camY = drawY - 6;

        const rect = _canvas.getBoundingClientRect();
        const scaleX = _canvas.width / rect.width;
        const scaleY = _canvas.height / rect.height;
        
        // Final logical coordinate = (click_pos * scale / tile_size) + camera_offset
        const tx = Math.floor(((e.clientX - rect.left) * scaleX) / 48 + camX);
        const ty = Math.floor(((e.clientY - rect.top)  * scaleY) / 48 + camY);

        // Find entity at logical coordinate
        const entities = appRuntime.world.query([Component.Transform, Component.Sprite]);
        let clickedEntity = null;
        for (const id of entities) {
            const t = appRuntime.world.getComponent(id, Component.Transform);
            const s = appRuntime.world.getComponent(id, Component.Sprite);
            const identity = appRuntime.world.getComponent(id, 'Identity');
            if (t.x === tx && t.y === ty && !appRuntime.world.getComponent(id, Component.PlayerControlled)) {
                clickedEntity = { id: identity?.id || id, type: s.type };
                break;
            }
        }

        onTileClick(tx, ty, clickedEntity);
    };
}

// Legacy UI Overlays - now mostly placeholders that emit ECS components
export function showToast(text) {
    const id = appRuntime.world.createEntity();
    appRuntime.world.setComponent(id, Component.UIOverlay, {
        type: 'toast',
        text,
        expires: Date.now() + 2500
    });
}

export function showItemFanfare(itemName) {
    const id = appRuntime.world.createEntity();
    appRuntime.world.setComponent(id, Component.UIOverlay, {
        type: 'fanfare',
        text: `You got\n${itemName}!`,
        expires: Date.now() + 1500
    });
}

export function showFloatingText(x, y, text) {
    const id = appRuntime.world.createEntity();
    appRuntime.world.setComponent(id, Component.UIOverlay, {
        type: 'toast', // Fallback to toast for Step 1
        text: text,
        expires: Date.now() + 1000
    });
}

export function showRoomBanner(roomName) {
    const id = appRuntime.world.createEntity();
    appRuntime.world.setComponent(id, Component.UIOverlay, {
        type: 'banner',
        text: roomName,
        expires: Date.now() + 2000
    });
}

export function showLevelUp(level) {
    const id = appRuntime.world.createEntity();
    appRuntime.world.setComponent(id, Component.UIOverlay, {
        type: 'fanfare',
        text: `⬆ Level ${level}!`,
        expires: Date.now() + 2000
    });
}

// Re-exports for bootstrap
export { showDialogue, advanceDialogue, isDialogueOpen, triggerHitFlash, setTicker, setVisualRefreshCallback, setLogicalRefreshCallback } from './renderer-ui-compat.js';

// @ts-check

import { appRuntime } from '../app/runtime.js';
import { getGameAreaEl, getShellElement } from '../adapters/dom/shell.js';
import { Component } from '../domain/components.js';
import { isDialogueOpen } from './renderer-ui-compat.js';
import { bus } from '../state/eventbus.js';
import { ACTION } from '../engine/input.js';

let _canvas = null;
let _ctx = null;
let _radarEl = null;
let _devMode = false;

const getSpriteKind = (sprite) => {
    if (!sprite) return null;
    if (sprite.palette === 'enemy') return 'enemy';
    if (typeof sprite.palette === 'string' && sprite.palette.startsWith('npc')) return 'npc';
    if (sprite.palette === 'self' || sprite.palette === 'peer') return 'player';
    if (sprite.type === 'peer' || sprite.type === 'player') return 'player';
    return sprite.type;
};

export function initCanvas() {
    if (_canvas) return;
    _radarEl = getShellElement('radar-container');
    const container = getGameAreaEl();

    _canvas = document.createElement('canvas');
    _canvas.id = 'game-canvas';
    _canvas.className = 'game-canvas';
    
    // Initial size from appRuntime config
    _canvas.width = appRuntime.VP.CW;
    _canvas.height = appRuntime.VP.CH;

    _ctx = _canvas.getContext('2d');
    if (_ctx) _ctx.imageSmoothingEnabled = false;

    if (container) {
        container.appendChild(_canvas);
        
        // Step 3 — Scale-to-fit via ResizeObserver (ADR-014)
        const resizeObs = new ResizeObserver(() => {
            const scale = Math.min(container.clientWidth / appRuntime.VP.CW, container.clientHeight / appRuntime.VP.CH);
            _canvas.style.transform = `scale(${scale})`;
            _canvas.style.transformOrigin = 'top left';
            
            // Center the scaled canvas
            const scaledW = appRuntime.VP.CW * scale;
            const scaledH = appRuntime.VP.CH * scale;
            _canvas.style.marginLeft = `${(container.clientWidth - scaledW) / 2}px`;
            _canvas.style.marginTop = `${(container.clientHeight - scaledH) / 2}px`;
        });
        resizeObs.observe(container);
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
    _canvas.onmousemove = (e) => {
        const menu = appRuntime.world.getComponent(appRuntime.playerEntityId, Component.Menu);
        if (!menu || !appRuntime.uiRender) return;
        const rect = _canvas.getBoundingClientRect();
        
        // CSS scaling factor
        const scaleX = _canvas.width / rect.width;
        const scaleY = _canvas.height / rect.height;
        
        const cx = (e.clientX - rect.left) * scaleX;
        const cy = (e.clientY - rect.top)  * scaleY;
        
        const idx = appRuntime.uiRender.resolveMenuClick(cx, cy);
        if (idx !== -1 && idx !== menu.selectedIndex && !menu.entries[idx]?.disabled)
            menu.selectedIndex = idx;
    };

    _canvas.onwheel = (e) => {
        const menu = appRuntime.world.getComponent(appRuntime.playerEntityId, Component.Menu);
        if (!menu) return;
        e.preventDefault();
        bus.emit('input:action', { action: e.deltaY > 0 ? ACTION.PAGE_DOWN : ACTION.PAGE_UP, type: 'down' });
    };

    _canvas.onclick = (e) => {
        const rect = _canvas.getBoundingClientRect();
        const scaleX = _canvas.width / rect.width;
        const scaleY = _canvas.height / rect.height;

        const canvasX = (e.clientX - rect.left) * scaleX;
        const canvasY = (e.clientY - rect.top) * scaleY;

        if (isDialogueOpen()) {
            if (appRuntime.uiRender?.resolveDialogueClick(canvasX, canvasY)) {
                bus.emit('input:action', { action: ACTION.CANCEL, type: 'down' });
            } else {
                bus.emit('input:action', { action: ACTION.INTERACT, type: 'down' });
            }
            return;
        }

        const transform = appRuntime.world.getComponent(appRuntime.playerEntityId, Component.Transform);
        const tween = appRuntime.world.getComponent(appRuntime.playerEntityId, Component.Tweenable);
        if (!transform) return;

        let drawX = transform.x;
        let drawY = transform.y;
        if (tween) {
            drawX = tween.startX + (tween.targetX - tween.startX) * tween.progress;
            drawY = tween.startY + (tween.targetY - tween.startY) * tween.progress;
        }

        const room = state.world?.[transform.mapId];
        const { camX, camY, screenOffsetX, screenOffsetY } = appRuntime.getViewportTransform(drawX, drawY, transform.mapId);

        if (appRuntime.uiRender) {
            const menuIndex = appRuntime.uiRender.resolveMenuClick(canvasX, canvasY);
            if (menuIndex !== -1) {
                bus.emit('ui:menu-select', { index: menuIndex });
                return;
            }
            const hudHit = appRuntime.uiRender.resolveHUDClick(canvasX, canvasY);
            if (hudHit) {
                bus.emit('ui:hud-action', hudHit);
                return;
            }
        }

        const localCanvasX = canvasX - screenOffsetX;
        const localCanvasY = canvasY - screenOffsetY;
        if (room) {
            const roomWidthPx = room.width * appRuntime.VP.S;
            const roomHeightPx = room.height * appRuntime.VP.S;
            if (localCanvasX < 0 || localCanvasY < 0 || localCanvasX >= roomWidthPx || localCanvasY >= roomHeightPx) {
                return;
            }
        }

        const tx = Math.floor(localCanvasX / appRuntime.VP.S) + camX;
        const ty = Math.floor(localCanvasY / appRuntime.VP.S) + camY;

        // Find entity at logical coordinate
        const entities = appRuntime.world.query([Component.Transform, Component.Sprite]);
        let clickedEntity = null;
        if (tx === transform.x && ty === transform.y) {
            clickedEntity = { id: 'self', type: 'self' };
        }
        for (const id of entities) {
            const t = appRuntime.world.getComponent(id, Component.Transform);
            const s = appRuntime.world.getComponent(id, Component.Sprite);
            const identity = appRuntime.world.getComponent(id, 'Identity');
            if (t.x === tx && t.y === ty && !appRuntime.world.getComponent(id, Component.PlayerControlled)) {
                clickedEntity = { id: identity?.id || id, type: getSpriteKind(s) };
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
export { showDialogue, advanceDialogue, isDialogueOpen, getTickerText, triggerHitFlash, setTicker, setVisualRefreshCallback, setLogicalRefreshCallback } from './renderer-ui-compat.js';

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
        const rect = _canvas.getBoundingClientRect();
        const scaleX = _canvas.width / rect.width;
        const scaleY = _canvas.height / rect.height;
        
        // We need camX/camY. For now we use a simple projection or 
        // pull it from the Camera component if we had one active.
        // For Step 1, we just wire a basic click.
        const tx = Math.floor((e.clientX - rect.left) * scaleX / 48); // hardcoded tile size for now
        const ty = Math.floor((e.clientY - rect.top)  * scaleY / 48);
        onTileClick(tx, ty, null);
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

// @ts-check

/**
 * Temporary compatibility layer for legacy UI functions that haven't 
 * been fully moved into ECS components yet.
 */

let _dialogue = null;
let _hitFlash = 0;
let _tickerText = '';
let _banner = null;
let _triggerVisualRefresh = null;
let _triggerLogicalRefresh = null;

export function setVisualRefreshCallback(fn) { _triggerVisualRefresh = fn; }
export function setLogicalRefreshCallback(fn) { _triggerLogicalRefresh = fn; }

export function showDialogue(npcName, text) {
    if (!text) return;

    const CHARS_PER_LINE = 38;
    const LINES_PER_PAGE = 3;
    const words = String(text).split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
        if ((cur + (cur ? ' ' : '') + w).length > CHARS_PER_LINE) {
            if (cur) lines.push(cur);
            cur = w;
        } else {
            cur = cur ? cur + ' ' + w : w;
        }
    }
    if (cur) lines.push(cur);

    const pages = [];
    for (let i = 0; i < lines.length; i += LINES_PER_PAGE) {
        pages.push(lines.slice(i, i + LINES_PER_PAGE));
    }
    if (!pages.length) return;
    
    _dialogue = { name: npcName, pages, page: 0 };
    if (_triggerVisualRefresh) _triggerVisualRefresh();
    if (_triggerLogicalRefresh) _triggerLogicalRefresh();
}

export function advanceDialogue() {
    if (!_dialogue) return false;
    if (_dialogue.page < (_dialogue.pages?.length || 0) - 1) {
        _dialogue.page++;
        if (_triggerVisualRefresh) _triggerVisualRefresh();
        if (_triggerLogicalRefresh) _triggerLogicalRefresh();
        return true;
    }
    _dialogue = null;
    if (_triggerVisualRefresh) _triggerVisualRefresh();
    if (_triggerLogicalRefresh) _triggerLogicalRefresh();
    return false;
}

export function isDialogueOpen() { return _dialogue !== null; }
export function triggerHitFlash() { 
    _hitFlash = Date.now() + 200; 
    if (_triggerVisualRefresh) _triggerVisualRefresh();
}
export function setTicker(text) { 
    _tickerText = text; 
    if (_triggerVisualRefresh) _triggerVisualRefresh();
}
export function showRoomBanner(text) { 
    _banner = { text, expires: Date.now() + 2000 }; 
    if (_triggerVisualRefresh) _triggerVisualRefresh();
}

import { drawRadar } from './ui.js';

export function renderWorld(state, onTileClick) {
  // Phase 7.5: calls drawRadar
  drawRadar(state, onTileClick);
}

export function showFloatingText(x, y, text, style) {
  // Phase 7.5: log line (handled via bus in ui.js)
}

export function showToast(message, style) {
  // Phase 7.5: log line
}

export function showSpeechBubble(entityId, text) {
  // Phase 7.5: log line
}

export function showDialogue(npcId, text, mood) {
  // Phase 7.5: handled via npc:speak event
}

export function showInventoryPanel(items, equipped) {
  // Phase 7.5: chip menu (handled in ui.js)
}

export function showQuestPanel(quests) {
  // Phase 7.5: chip list (handled in ui.js)
}

export function showShopPanel(npcId, inventory) {
  // Phase 7.5: chip menu (handled in ui.js)
}

export function updateHUD(player, world) {
  // Phase 7.5: status bar (handled in ui.js renderActionButtons)
}

export function renderMinimap(state) {
  // Phase 7.5: nothing (radar still shown)
}

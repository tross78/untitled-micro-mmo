/**
 * Hearthwick EventBus
 * Decouples game logic (commands) from the UI (Text Log, Radar).
 */

export const EventBus = {
    emit(type, detail = {}) {
        window.dispatchEvent(new CustomEvent(`game:${type}`, { detail }));
    },
    
    on(type, callback) {
        const handler = (e) => callback(e.detail);
        window.addEventListener(`game:${type}`, handler);
        return () => window.removeEventListener(`game:${type}`, handler);
    }
};

/**
 * Common Event Types:
 * - log: { msg, color }
 * - player_moved: { from, to, x, y }
 * - peer_moved: { peerId, from, to, x, y }
 * - combat_hit: { attacker, target, damage, isCrit, isDodge }
 * - status_update: { stats }
 */

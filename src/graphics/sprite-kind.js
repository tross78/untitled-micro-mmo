// @ts-check

/**
 * Classify a sprite for click/interaction routing.
 * Resource gatherables may carry a type-specific palette key like `resource:log`.
 *
 * @param {{ palette?: string, type?: string } | null | undefined} sprite
 * @returns {'enemy' | 'resource' | 'npc' | 'player' | string | null}
 */
export const getSpriteKind = (sprite) => {
    if (!sprite) return null;
    if (sprite.palette === 'enemy') return 'enemy';
    if (typeof sprite.palette === 'string' && sprite.palette.startsWith('resource')) return 'resource';
    if (typeof sprite.palette === 'string' && sprite.palette.startsWith('npc')) return 'npc';
    if (sprite.palette === 'self' || sprite.palette === 'peer') return 'player';
    if (sprite.type === 'peer' || sprite.type === 'player') return 'player';
    return sprite.type;
};

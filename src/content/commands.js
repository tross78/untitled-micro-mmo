// @ts-check

import { defineCommand } from './define.js';

/**
 * These are the canonical command definitions for registry lookups, UI metadata,
 * and future replacement of the command interpreter. Execution still delegates to
 * the existing gameplay handlers during this transition phase.
 */
export const commandDefinitions = [
  defineCommand({ id: 'attack', category: 'combat', description: 'Attack the current enemy.' }),
  defineCommand({ id: 'flee', category: 'combat', description: 'Attempt to escape combat.' }),
  defineCommand({ id: 'rest', category: 'combat', description: 'Recover health outside combat.' }),
  defineCommand({ id: 'die', category: 'combat', description: 'Developer death shortcut.' }),
  defineCommand({ id: 'interact', category: 'movement', description: 'Use the current tile, NPC, or exit.' }),
  defineCommand({ id: 'pickup', aliases: ['get'], category: 'movement', description: 'Pick up loot.' }),
  defineCommand({ id: 'look', category: 'movement', description: 'Describe the current room.' }),
  defineCommand({ id: 'move', aliases: ['go'], category: 'movement', description: 'Move to an adjacent room.' }),
  defineCommand({ id: 'map', category: 'movement', description: 'Show the world map.' }),
  defineCommand({ id: 'equip', category: 'inventory', description: 'Equip an item from inventory.' }),
  defineCommand({ id: 'inventory', category: 'inventory', description: 'Show inventory.' }),
  defineCommand({ id: 'use', category: 'inventory', description: 'Use a consumable or buff item.' }),
  defineCommand({ id: 'drop', category: 'inventory', description: 'Drop an item.' }),
  defineCommand({ id: 'craft', category: 'inventory', description: 'Craft an item.' }),
  defineCommand({ id: 'trade', category: 'inventory', description: 'Trade with another player.' }),
  defineCommand({ id: 'talk', category: 'npc', description: 'Talk to an NPC.' }),
  defineCommand({ id: 'buy', category: 'npc', description: 'Buy an item.' }),
  defineCommand({ id: 'sell', category: 'npc', description: 'Sell an item.' }),
  defineCommand({ id: 'quest', category: 'npc', description: 'Manage quests.' }),
  defineCommand({ id: 'bank', category: 'npc', description: 'Use the bank.' }),
  defineCommand({ id: 'vision', category: 'npc', description: 'Use the bard vision feature.' }),
  defineCommand({ id: 'who', category: 'social', description: 'List nearby players.' }),
  defineCommand({ id: 'say', category: 'social', description: 'Speak in the current room.' }),
  defineCommand({ id: 'wave', category: 'social', description: 'Wave to nearby players.' }),
  defineCommand({ id: 'bow', category: 'social', description: 'Bow to nearby players.' }),
  defineCommand({ id: 'cheer', category: 'social', description: 'Cheer loudly.' }),
  defineCommand({ id: 'rename', category: 'social', description: 'Rename your character.' }),
  defineCommand({ id: 'duel', category: 'social', description: 'Challenge another player.' }),
  defineCommand({ id: 'accept', category: 'social', description: 'Accept a pending duel or action.' }),
  defineCommand({ id: 'decline', category: 'social', description: 'Decline a pending duel or action.' }),
  defineCommand({ id: 'status', category: 'misc', description: 'Show world status.' }),
  defineCommand({ id: 'help', category: 'misc', description: 'Show command help.' }),
  defineCommand({ id: 'net', category: 'misc', description: 'Show network status.' }),
  defineCommand({ id: 'score', category: 'misc', description: 'Show top adventurers.' }),
  defineCommand({ id: 'stats', category: 'misc', description: 'Show player stats.' }),
  defineCommand({ id: 'clear', category: 'misc', description: 'Clear the debug log.' }),
  defineCommand({ id: 'addxp', category: 'admin', description: 'Grant XP.' }),
  defineCommand({ id: 'addgold', category: 'admin', description: 'Grant gold.' }),
  defineCommand({ id: 'spawn', category: 'admin', description: 'Spawn an item.' }),
];

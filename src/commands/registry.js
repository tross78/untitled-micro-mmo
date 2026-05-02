// @ts-check

import { commandDefinitions } from '../content/commands.js';

const commandMap = new Map();
for (const definition of commandDefinitions) {
  commandMap.set(definition.id, definition);
  for (const alias of definition.aliases || []) {
    commandMap.set(alias, definition);
  }
}

export const parseCommandInput = (raw) => {
  const clean = raw.trim().replace(/^\//, '');
  const args = clean ? clean.split(/\s+/) : [];
  const commandId = args[0]?.toLowerCase() || '';
  return { raw: clean, args, commandId };
};

export const getCommandDefinition = (id) => commandMap.get(id);
export const listCommandDefinitions = () => commandDefinitions.slice();

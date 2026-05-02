import { commandDefinitions } from '../content/commands.js';
import { validateContent } from '../content/validate.js';
import { getCommandDefinition, parseCommandInput } from '../commands/registry.js';

describe('content validation', () => {
    test('current content definitions validate cleanly', () => {
        const result = validateContent();
        expect(result.ok).toBe(true);
        expect(result.problems).toEqual([]);
    });
});

describe('command registry', () => {
    test('canonical command ids are unique', () => {
        const ids = commandDefinitions.map((definition) => definition.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    test('aliases resolve to canonical definitions', () => {
        expect(getCommandDefinition('get')?.id).toBe('pickup');
        expect(getCommandDefinition('go')?.id).toBe('move');
    });

    test('command input parser strips slash and lowercases lookup id', () => {
        const parsed = parseCommandInput('/Go North');
        expect(parsed.raw).toBe('Go North');
        expect(parsed.commandId).toBe('go');
        expect(parsed.args).toEqual(['Go', 'North']);
    });
});

import { jest } from '@jest/globals';
import { handleMiscCommands } from '../commands/misc.js';
import { log } from '../ui/index.js';

// Mock log to capture output
jest.mock('../ui/index.js', () => ({
    log: jest.fn(),
    printStatus: jest.fn()
}));

describe('Phase 8.5e: Onboarding and Help', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('help command returns basic command info', async () => {
        await handleMiscCommands('help', []);
        expect(log).toHaveBeenCalledWith(expect.stringContaining('Movement'), '#ffa500');
    });

    // Note: help-controls is implemented in events.js coordinator, 
    // so we verify the command definition exists in registry or content.
    test('help-controls is a recognized command definition', async () => {
        const { commandDefinitions } = await import('../content/commands.js');
        const controls = commandDefinitions.find(c => c.id === 'help-controls');
        expect(controls).toBeDefined();
        expect(controls.category).toBe('misc');
    });
});

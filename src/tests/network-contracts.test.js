import { NETWORK_ACTIONS } from '../network/contracts.js';

describe('Network contracts', () => {
    test('shared arbiter/client action names stay centralized', () => {
        expect(NETWORK_ACTIONS).toEqual({
            ROLLUP_SUBMIT: 'rollup_submit',
            FRAUD_REPORT: 'fraud_report',
            WORLD_STATE: 'world_state',
        });
    });

    test('network action values remain unique', () => {
        const values = Object.values(NETWORK_ACTIONS);
        expect(new Set(values).size).toBe(values.length);
    });
});


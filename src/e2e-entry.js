import { installFakeTransport } from './tests/e2e/fake-transport.js';
import { installRealWebRTCTransport } from './tests/e2e/real-webrtc-transport.js';
import { useFakeTransport, isE2EMode } from './infra/runtime.js';

const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
if (isE2EMode() && params?.get('transport') === 'real') {
    installRealWebRTCTransport();
} else if (useFakeTransport()) {
    installFakeTransport();
}

import('./main.js').then(async () => {
    const [{ buildTestSnapshot }, { handleCommand }, { triggerLogicalRefresh }, { appRuntime }] = await Promise.all([
        import('./main/snapshot.js'),
        import('./commands/index.js'),
        import('./main/events.js'),
        import('./app/runtime.js')
    ]);

    const stepMap = new Map([
        ['1,0', 'move east'],
        ['-1,0', 'move west'],
        ['0,1', 'move south'],
        ['0,-1', 'move north']
    ]);

    const flushFrames = async (count = 20) => {
        for (let i = 0; i < count; i++) {
            appRuntime.update(1 / 60);
        }
        triggerLogicalRefresh();
        await new Promise(resolve => setTimeout(resolve, 50));
    };

    window.__FENHOLLOW_TEST__ = {
        getSnapshot: () => buildTestSnapshot(),
        issueCommand: async (cmd) => {
            await handleCommand(cmd);
            await flushFrames();
            return buildTestSnapshot();
        },
        step: async (dx, dy) => {
            const cmd = stepMap.get(`${dx},${dy}`);
            if (!cmd) throw new Error(`Unsupported step: ${dx},${dy}`);
            await handleCommand(cmd);
            await flushFrames();
            return buildTestSnapshot();
        }
    };
    window.__HEARTHWICK_TEST__ = window.__FENHOLLOW_TEST__;
});

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { TORRENT_TRACKERS } from '../src/constants.js';

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const waitFor = async (label, fn, timeoutMs = 10000, intervalMs = 100) => {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
        try {
            const result = await fn();
            if (result) return result;
        } catch (err) {
            lastError = err;
        }
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    throw new Error(lastError ? `${label}: ${lastError.message}` : `${label} timed out`);
};

const waitForProcessExit = async (child, timeoutMs = 5000) => {
    if (!child || child.exitCode != null) return;
    await Promise.race([
        new Promise(resolve => child.once('exit', resolve)),
        new Promise(resolve => setTimeout(resolve, timeoutMs)),
    ]);
};

const startChrome = async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'hearthwick-probe-'));
    const child = spawn(chromePath, [
        '--headless',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-debugging-port=0',
        `--user-data-dir=${userDataDir}`,
        'about:blank',
    ], {
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buffer = '';
    const onData = (chunk) => { buffer += chunk.toString(); };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    const devtoolsPort = await waitFor('chrome devtools readiness', async () => {
        const file = await readFile(join(userDataDir, 'DevToolsActivePort'), 'utf8').catch(() => '');
        const [portLine] = file.trim().split('\n');
        return portLine ? Number(portLine) : null;
    }, 10000).catch(err => {
        if (child.exitCode != null) {
            throw new Error(`Chrome exited early (${child.exitCode}). Output:\n${buffer}`);
        }
        throw new Error(`${err.message}\n${buffer}`.trim());
    });

    return { child, endpoint: `http://127.0.0.1:${devtoolsPort}`, userDataDir };
};

class CdpClient {
    constructor(wsUrl) {
        this.wsUrl = wsUrl;
        this.ws = null;
        this.nextId = 1;
        this.pending = new Map();
    }

    async connect() {
        await new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.wsUrl);
            this.ws.addEventListener('open', resolve, { once: true });
            this.ws.addEventListener('error', reject, { once: true });
            this.ws.addEventListener('message', (event) => {
                const msg = JSON.parse(event.data);
                if (!msg.id) return;
                const pending = this.pending.get(msg.id);
                if (!pending) return;
                this.pending.delete(msg.id);
                if (msg.error) pending.reject(new Error(msg.error.message));
                else pending.resolve(msg.result);
            });
        });
    }

    send(method, params = {}) {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }

    async evaluate(expression) {
        const result = await this.send('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true,
        });
        return result.result?.value;
    }

    async close() {
        try { this.ws?.close(); } catch {}
    }
}

const openPage = async (endpoint) => {
    const res = await fetch(`${endpoint}/json/new?about:blank`, { method: 'PUT' });
    if (!res.ok) throw new Error(`Failed to create page: ${await res.text()}`);
    const target = await res.json();
    const client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    return client;
};

let chrome;
let page;
try {
    chrome = await startChrome();
    page = await openPage(chrome.endpoint);

    const trackers = [
        ...TORRENT_TRACKERS,
        'wss://tracker.webtorrent.dev',
    ];

    const result = await page.evaluate(`
        (async () => {
            const trackers = ${JSON.stringify(trackers)};
            const probe = (url) => new Promise((resolve) => {
                let settled = false;
                const done = (status, detail = '') => {
                    if (settled) return;
                    settled = true;
                    try { ws.close(); } catch {}
                    resolve({ url, status, detail });
                };
                let ws;
                try {
                    ws = new WebSocket(url);
                } catch (err) {
                    resolve({ url, status: 'construct_error', detail: String(err && err.message || err) });
                    return;
                }
                const timer = setTimeout(() => done('timeout'), 5000);
                ws.onopen = () => { clearTimeout(timer); done('open'); };
                ws.onerror = () => { clearTimeout(timer); done('error'); };
                ws.onclose = (ev) => { clearTimeout(timer); done('close', String(ev.code)); };
            });
            return Promise.all(trackers.map(probe));
        })()
    `);

    console.log(JSON.stringify(result, null, 2));
} finally {
    await page?.close();
    if (chrome?.child) {
        chrome.child.kill('SIGTERM');
        await waitForProcessExit(chrome.child);
    }
    if (chrome?.userDataDir) await rm(chrome.userDataDir, { recursive: true, force: true });
}

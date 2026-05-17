import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { cwd } from 'node:process';

const root = cwd();
const distDir = join(root, 'dist');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
};

const serveDist = async () => {
    const server = createServer(async (req, res) => {
        const rawPath = req.url === '/' ? '/e2e.html' : req.url.split('?')[0];
        const relPath = normalize(rawPath).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]/, '');
        const filePath = join(distDir, relPath);
        try {
            const body = await readFile(filePath);
            res.writeHead(200, { 'content-type': mimeTypes[extname(filePath)] || 'application/octet-stream' });
            res.end(body);
        } catch {
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('Not found');
        }
    });

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
};

const waitFor = async (label, fn, timeoutMs = 30000, intervalMs = 250) => {
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

const startChrome = async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'hearthwick-live-reconnect-'));
    const child = spawn(chromePath, [
        '--headless',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-debugging-port=0',
        `--user-data-dir=${userDataDir}`,
        'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let buffer = '';
    const onData = (chunk) => { buffer += chunk.toString(); };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    const devtoolsPort = await waitFor('chrome devtools readiness', async () => {
        const file = await readFile(join(userDataDir, 'DevToolsActivePort'), 'utf8').catch(() => '');
        const [portLine] = file.trim().split('\n');
        return portLine ? Number(portLine) : null;
    }, 10000, 100).catch(err => {
        if (child.exitCode != null) {
            throw new Error(`Chrome exited early (${child.exitCode}). Output:\n${buffer}`);
        }
        throw new Error(`${err.message}\n${buffer}`.trim());
    });

    return { child, endpoint: `http://127.0.0.1:${devtoolsPort}`, userDataDir };
};

class CdpClient {
    constructor(wsUrl, closeUrl) {
        this.wsUrl = wsUrl;
        this.closeUrl = closeUrl;
        this.ws = null;
        this.nextId = 1;
        this.pending = new Map();
        this.consoleLogs = [];
    }

    async connect() {
        await new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.wsUrl);
            this.ws.addEventListener('open', resolve, { once: true });
            this.ws.addEventListener('error', reject, { once: true });
            this.ws.addEventListener('message', (event) => {
                const msg = JSON.parse(event.data);
                if (!msg.id) {
                    if (msg.method === 'Runtime.consoleAPICalled') {
                        const type = msg.params?.type || 'log';
                        const args = (msg.params?.args || []).map(arg => arg.value ?? arg.description ?? '').join(' ');
                        this.consoleLogs.push(`[${type}] ${args}`.trim());
                        if (this.consoleLogs.length > 200) this.consoleLogs.shift();
                    }
                    if (msg.method === 'Log.entryAdded') {
                        const entry = msg.params?.entry;
                        const line = `[${entry?.level || 'info'}] ${entry?.text || ''}`.trim();
                        this.consoleLogs.push(line);
                        if (this.consoleLogs.length > 200) this.consoleLogs.shift();
                    }
                    return;
                }
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
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed');
        return result.result?.value;
    }

    async close() {
        if (this.closeUrl) {
            try { await fetch(this.closeUrl); } catch {}
        }
        try { this.ws?.close(); } catch {}
    }
}

const openPage = async (endpoint, url) => {
    const res = await fetch(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
    if (!res.ok) throw new Error(`Failed to create page: ${await res.text()}`);
    const target = await res.json();
    const client = new CdpClient(target.webSocketDebuggerUrl, `${endpoint}/json/close/${target.id}`);
    await client.connect();
    await client.send('Page.enable');
    await client.send('Log.enable');
    await client.send('Runtime.enable');
    await waitFor('document readiness', async () => {
        const ready = await client.evaluate('document.readyState');
        return ready === 'complete';
    }, 15000, 100);
    await waitFor('test api readiness', async () => {
        const ready = await client.evaluate('typeof window.__HEARTHWICK_TEST__ === "object"');
        return ready === true;
    }, 15000, 100);
    return client;
};

const getSnapshot = (client) => client.evaluate('window.__HEARTHWICK_TEST__.getSnapshot()');
const issueCommand = (client, cmd) => client.evaluate(`window.__HEARTHWICK_TEST__.issueCommand(${JSON.stringify(cmd)})`);
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const DISCOVERY_TIMEOUT_MS = 45000;
const LEAVE_TIMEOUT_MS = 45000;
const REDISCOVERY_TIMEOUT_MS = 45000;

const buildLatencySummary = (snapshot, peerId) => {
    const peerAudit = snapshot?.network?.audit?.peers?.[peerId];
    return {
        peerId,
        startedAt: snapshot?.network?.audit?.startedAt,
        sameRoomLivePeers: snapshot?.network?.audit?.sameRoomLivePeers || [],
        events: peerAudit?.events || {},
        history: peerAudit?.history || [],
        globalEvents: snapshot?.network?.audit?.events || [],
    };
};

const waitForProcessExit = async (child, timeoutMs = 5000) => {
    if (!child || child.exitCode != null) return;
    await Promise.race([
        new Promise(resolve => child.once('exit', resolve)),
        new Promise(resolve => setTimeout(resolve, timeoutMs)),
    ]);
};

let chrome;
let server;
let pageA;
let pageB;

try {
    const served = await serveDist();
    server = served.server;
    const baseUrl = served.baseUrl;
    chrome = await startChrome();

    const urlA = `${baseUrl}/e2e.html?e2e=1&transport=real&scope=reconnect-peer-a&name=Alpha&debugnet=1`;
    const urlB = `${baseUrl}/e2e.html?e2e=1&transport=real&scope=reconnect-peer-b&name=Beta&debugnet=1`;

    pageA = await openPage(chrome.endpoint, urlA);
    pageB = await openPage(chrome.endpoint, urlB);

    await waitFor('peer A boot', async () => (await getSnapshot(pageA))?.localPlayer?.ph);
    await waitFor('peer B boot', async () => (await getSnapshot(pageB))?.localPlayer?.ph);

    const initialA = await getSnapshot(pageA);
    const initialB = await getSnapshot(pageB);
    assert(initialA.selfId !== initialB.selfId, 'real transport peers reused the same peer id');

    const discoveryStartedAt = Date.now();
    const initialDiscovery = await waitFor('initial real transport discovery', async () => {
        const [snapA, snapB] = await Promise.all([getSnapshot(pageA), getSnapshot(pageB)]);
        const aSeesB = snapA.peers.some(p => p.id === initialB.selfId && !p.ghost);
        const bSeesA = snapB.peers.some(p => p.id === initialA.selfId && !p.ghost);
        return aSeesB && bSeesA ? { snapA, snapB } : null;
    }, DISCOVERY_TIMEOUT_MS, 500);
    const initialDiscoveryMs = Date.now() - discoveryStartedAt;

    await issueCommand(pageA, 'rename Alpha');
    await issueCommand(pageB, 'rename Beta');

    await waitFor('initial name propagation', async () => {
        const [snapA, snapB] = await Promise.all([getSnapshot(pageA), getSnapshot(pageB)]);
        const aSeesB = snapA.peers.some(p => p.id === initialB.selfId && p.name === 'Beta');
        const bSeesA = snapB.peers.some(p => p.id === initialA.selfId && p.name === 'Alpha');
        return aSeesB && bSeesA;
    }, 30000, 500);

    await pageB.close();
    pageB = null;

    const leaveStartedAt = Date.now();
    const leaveSnapshot = await waitFor('peer B disappearance', async () => {
        const snapA = await getSnapshot(pageA);
        const stillSeesB = snapA.peers.some(p => p.id === initialB.selfId && !p.ghost);
        return stillSeesB ? null : snapA;
    }, LEAVE_TIMEOUT_MS, 500);
    const leaveMs = Date.now() - leaveStartedAt;

    const reconnectPage = await openPage(chrome.endpoint, urlB);
    pageB = reconnectPage;
    await waitFor('peer B reboot', async () => (await getSnapshot(pageB))?.localPlayer?.ph);
    const restartedB = await getSnapshot(pageB);
    assert(restartedB.selfId !== initialA.selfId, 'restarted peer B reused peer A id');

    const rediscoveryStartedAt = Date.now();
    const rediscovery = await waitFor('peer B rediscovery', async () => {
        const [snapA, snapB] = await Promise.all([getSnapshot(pageA), getSnapshot(pageB)]);
        const aSeesNewB = snapA.peers.some(p => p.id === restartedB.selfId && !p.ghost);
        const bSeesA = snapB.peers.some(p => p.id === initialA.selfId && !p.ghost);
        return aSeesNewB && bSeesA ? { snapA, snapB } : null;
    }, REDISCOVERY_TIMEOUT_MS, 500);
    const rediscoveryMs = Date.now() - rediscoveryStartedAt;

    console.log('Two-peer live reconnect E2E passed.');
    console.log(JSON.stringify({
        initialDiscoveryMs,
        leaveMs,
        rediscoveryMs,
        peerAInitial: buildLatencySummary(initialDiscovery.snapA, initialB.selfId),
        peerALeaveState: leaveSnapshot.network,
        peerARediscovery: buildLatencySummary(rediscovery.snapA, restartedB.selfId),
        peerBRediscovery: buildLatencySummary(rediscovery.snapB, initialA.selfId),
        ids: {
            peerA: initialA.selfId,
            peerBInitial: initialB.selfId,
            peerBRestarted: restartedB.selfId,
        },
    }, null, 2));
} catch (err) {
    const snapA = await pageA?.evaluate('window.__HEARTHWICK_TEST__ ? window.__HEARTHWICK_TEST__.getSnapshot() : null').catch(() => null);
    const snapB = await pageB?.evaluate('window.__HEARTHWICK_TEST__ ? window.__HEARTHWICK_TEST__.getSnapshot() : null').catch(() => null);
    console.error('LIVE RECONNECT FAILURE');
    console.error(JSON.stringify({
        error: err.message,
        peerA: {
            snapshot: snapA,
            console: pageA?.consoleLogs?.slice(-120) || [],
        },
        peerB: {
            snapshot: snapB,
            console: pageB?.consoleLogs?.slice(-120) || [],
        },
    }, null, 2));
    throw err;
} finally {
    await pageA?.close();
    await pageB?.close();
    if (chrome?.child) {
        chrome.child.kill('SIGTERM');
        await waitForProcessExit(chrome.child);
    }
    if (chrome?.userDataDir) await rm(chrome.userDataDir, { recursive: true, force: true });
    if (server) await new Promise(resolve => server.close(resolve));
}

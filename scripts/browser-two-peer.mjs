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
    return {
        server,
        baseUrl: `http://127.0.0.1:${addr.port}`,
    };
};

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

const startChrome = async () => {
    const port = 9222;
    const userDataDir = await mkdtemp(join(tmpdir(), 'hearthwick-e2e-'));
    const child = spawn(chromePath, [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${userDataDir}`,
        'about:blank',
    ], {
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buffer = '';
    const onData = (chunk) => { buffer += chunk.toString(); };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    await waitFor('chrome devtools readiness', async () => {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`).catch(() => null);
        return res?.ok;
    }, 10000).catch(err => {
        if (child.exitCode != null) {
            throw new Error(`Chrome exited early (${child.exitCode}). Output:\n${buffer}`);
        }
        throw new Error(`${err.message}\n${buffer}`.trim());
    });

    return { child, endpoint: `http://127.0.0.1:${port}`, userDataDir };
};

class CdpClient {
    constructor(wsUrl) {
        this.wsUrl = wsUrl;
        this.ws = null;
        this.nextId = 1;
        this.pending = new Map();
        this.eventWaiters = [];
    }

    async connect() {
        await new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.wsUrl);
            this.ws.addEventListener('open', resolve, { once: true });
            this.ws.addEventListener('error', reject, { once: true });
            this.ws.addEventListener('message', (event) => {
                const msg = JSON.parse(event.data);
                if (msg.id) {
                    const pending = this.pending.get(msg.id);
                    if (!pending) return;
                    this.pending.delete(msg.id);
                    if (msg.error) pending.reject(new Error(msg.error.message));
                    else pending.resolve(msg.result);
                    return;
                }
                this.eventWaiters = this.eventWaiters.filter(waiter => {
                    if (waiter.method !== msg.method) return true;
                    if (waiter.predicate && !waiter.predicate(msg.params || {})) return true;
                    waiter.resolve(msg.params || {});
                    return false;
                });
            });
        });
    }

    send(method, params = {}) {
        const id = this.nextId++;
        const payload = { id, method, params };
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.ws.send(JSON.stringify(payload));
        });
    }

    waitForEvent(method, predicate, timeoutMs = 10000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.eventWaiters = this.eventWaiters.filter(waiter => waiter.resolve !== resolve);
                reject(new Error(`${method} timed out`));
            }, timeoutMs);
            this.eventWaiters.push({
                method,
                predicate,
                resolve: (params) => {
                    clearTimeout(timer);
                    resolve(params);
                },
            });
        });
    }

    async evaluate(expression) {
        const result = await this.send('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true,
        });
        if (result.exceptionDetails) {
            throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed');
        }
        return result.result?.value;
    }

    async close() {
        try {
            this.ws?.close();
        } catch {}
    }
}

const openPage = async (endpoint, url) => {
    const res = await fetch(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
    if (!res.ok) throw new Error(`Failed to create page: ${await res.text()}`);
    const target = await res.json();
    const client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await waitFor('document readiness', async () => {
        const ready = await client.evaluate('document.readyState');
        return ready === 'complete';
    }, 15000);
    await waitFor('test api readiness', async () => {
        const ready = await client.evaluate('typeof window.__HEARTHWICK_TEST__ === "object"');
        return ready === true;
    }, 15000);
    return client;
};

const getSnapshot = (client) => client.evaluate('window.__HEARTHWICK_TEST__.getSnapshot()');

const issueCommand = (client, cmd) =>
    client.evaluate(`window.__HEARTHWICK_TEST__.issueCommand(${JSON.stringify(cmd)})`);

const step = (client, dx, dy) =>
    client.evaluate(`window.__HEARTHWICK_TEST__.step(${JSON.stringify(dx)}, ${JSON.stringify(dy)})`);

const assert = (cond, msg) => {
    if (!cond) throw new Error(msg);
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

    const urlA = `${baseUrl}/e2e.html?e2e=1&scope=peer-a&peer=peer-a&name=Alpha`;
    const urlB = `${baseUrl}/e2e.html?e2e=1&scope=peer-b&peer=peer-b&name=Beta`;

    pageA = await openPage(chrome.endpoint, urlA);
    pageB = await openPage(chrome.endpoint, urlB);

    await waitFor('peer A boot', async () => (await getSnapshot(pageA))?.localPlayer?.ph, 15000);
    await waitFor('peer B boot', async () => (await getSnapshot(pageB))?.localPlayer?.ph, 15000);

    await waitFor('peer discovery', async () => {
        const [snapA, snapB] = await Promise.all([getSnapshot(pageA), getSnapshot(pageB)]);
        const seesB = snapA.peers.some(p => p.id === 'peer-b' && !p.ghost && p.location === 'cellar');
        const seesA = snapB.peers.some(p => p.id === 'peer-a' && !p.ghost && p.location === 'cellar');
        return seesA && seesB;
    }, 15000);

    await issueCommand(pageA, 'rename Alpha');
    await issueCommand(pageB, 'rename Beta');

    await waitFor('name propagation', async () => {
        const [snapA, snapB] = await Promise.all([getSnapshot(pageA), getSnapshot(pageB)]);
        const aSees = snapA.peers.some(p => p.id === 'peer-b' && p.name === 'Beta');
        const bSees = snapB.peers.some(p => p.id === 'peer-a' && p.name === 'Alpha');
        return aSees && bSees;
    }, 5000);

    await step(pageA, 1, 0);

    const moved = await waitFor('movement propagation', async () => {
        const snapB = await getSnapshot(pageB);
        return snapB.peers.find(p => p.id === 'peer-a' && p.x === 6 && p.y === 5);
    }, 5000);
    assert(!!moved, 'peer movement did not propagate');

    await issueCommand(pageA, 'move north');
    await issueCommand(pageA, 'move north');
    await waitFor('room transition to tavern', async () => {
        const snapA = await getSnapshot(pageA);
        return snapA.localPlayer.location === 'tavern';
    }, 5000);

    await issueCommand(pageA, 'talk barkeep');
    const dialogue = await waitFor('dialogue render', async () => {
        const snapA = await getSnapshot(pageA);
        return snapA.dialogueOpen === true;
    }, 5000);
    assert(dialogue, 'local gameplay command did not open dialogue');

    console.log('Two-peer browser E2E passed.');
} finally {
    await pageA?.close();
    await pageB?.close();
    if (chrome?.child) chrome.child.kill('SIGTERM');
    if (chrome?.userDataDir) await rm(chrome.userDataDir, { recursive: true, force: true });
    if (server) await new Promise(resolve => server.close(resolve));
}

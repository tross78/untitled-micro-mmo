/**
 * ICE Game Integration Test — Two Players Moving in the Same Shard
 *
 * Verifies that the full game networking stack (presence, movement, shard
 * sync) works over real WebRTC DataChannels + ICE/STUN — without any
 * torrent-tracker signaling.
 *
 * Transport: real-webrtc-transport.js
 *   - SDP/ICE signaling via BroadcastChannel (same Chrome process, no internet)
 *   - Data path via genuine RTCPeerConnection DataChannels
 *   - ICE candidates gathered from STUN (stun.l.google.com, stun.cloudflare.com)
 *
 * Run: npm run test:ice:game
 */

import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { cwd } from 'node:process';

const root    = cwd();
const distDir = join(root, 'dist');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
};

const assert = (cond, msg) => { if (!cond) throw new Error(`FAIL: ${msg}`); };

// ── HTTP server serving dist/ ─────────────────────────────────────────────────
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
            res.writeHead(404, { 'content-type': 'text/plain' });
            res.end('Not found');
        }
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const addr = server.address();
    return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
};

// ── Chrome / CDP helpers ──────────────────────────────────────────────────────
const waitFor = async (label, fn, timeoutMs = 15000, intervalMs = 200) => {
    const deadline = Date.now() + timeoutMs;
    let lastErr;
    while (Date.now() < deadline) {
        try {
            const v = await fn();
            if (v !== null && v !== undefined && v !== false) return v;
        } catch (e) { lastErr = e; }
        await new Promise(r => setTimeout(r, intervalMs));
    }
    throw new Error(lastErr ? `${label}: ${lastErr.message}` : `${label} timed out after ${timeoutMs}ms`);
};

const startChrome = async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ice-game-'));
    const child = spawn(chromePath, [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-debugging-port=0',
        `--user-data-dir=${userDataDir}`,
        'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let buf = '';
    child.stdout.on('data', d => { buf += d.toString(); });
    child.stderr.on('data', d => { buf += d.toString(); });

    const port = await waitFor('devtools port', async () => {
        const file = await readFile(join(userDataDir, 'DevToolsActivePort'), 'utf8').catch(() => '');
        const [line] = file.trim().split('\n');
        return line ? Number(line) : null;
    }, 12000).catch(err => {
        if (child.exitCode != null) throw new Error(`Chrome exited (${child.exitCode}):\n${buf}`);
        throw err;
    });

    return { child, endpoint: `http://127.0.0.1:${port}`, userDataDir };
};

class CdpClient {
    constructor(wsUrl) {
        this.wsUrl = wsUrl; this.ws = null; this.nextId = 1;
        this.pending = new Map(); this.consoleLogs = [];
    }

    async connect() {
        await new Promise((res, rej) => {
            this.ws = new WebSocket(this.wsUrl);
            this.ws.addEventListener('open', res, { once: true });
            this.ws.addEventListener('error', rej, { once: true });
            this.ws.addEventListener('message', ev => {
                const msg = JSON.parse(ev.data);
                if (msg.method === 'Runtime.consoleAPICalled') {
                    const text = (msg.params?.args || []).map(a => a.value ?? a.description ?? '').join(' ');
                    this.consoleLogs.push(`[${msg.params?.type}] ${text}`);
                    if (this.consoleLogs.length > 300) this.consoleLogs.shift();
                }
                if (!msg.id) return;
                const p = this.pending.get(msg.id);
                if (!p) return;
                this.pending.delete(msg.id);
                msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
            });
        });
    }

    send(method, params = {}) {
        const id = this.nextId++;
        return new Promise((res, rej) => {
            this.pending.set(id, { resolve: res, reject: rej });
            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }

    async evaluate(expr) {
        const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result?.value;
    }

    async close() { try { this.ws?.close(); } catch {} }
}

// Open a tab at url and return a connected CdpClient.
// Uses /json/new?url to navigate immediately on creation (Chrome headless=new).
const openPage = async (endpoint, url) => {
    const res = await fetch(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
    if (!res.ok) throw new Error(`new tab failed: ${await res.text()}`);
    const { webSocketDebuggerUrl } = await res.json();
    const client = new CdpClient(webSocketDebuggerUrl);
    await client.connect();
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await waitFor('document ready', () => client.evaluate(`document.readyState === 'complete' ? true : null`), 20000);
    await waitFor('test API ready',  () => client.evaluate(`typeof window.__HEARTHWICK_TEST__ === 'object' ? true : null`), 20000).catch(err => {
        console.error('console logs at failure:', client.consoleLogs.slice(-40).join('\n'));
        throw err;
    });
    return client;
};

// Open a tab and return connected CdpClient without waiting for the test API.
// Used to start both tabs' navigation simultaneously before waiting.
const openTabEarly = async (endpoint, url) => {
    const res = await fetch(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
    if (!res.ok) throw new Error(`new tab failed: ${await res.text()}`);
    const { webSocketDebuggerUrl } = await res.json();
    const client = new CdpClient(webSocketDebuggerUrl);
    await client.connect();
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    return client;
};

const waitForTestApi = async (client) => {
    await waitFor('document ready', () => client.evaluate(`document.readyState === 'complete' ? true : null`), 20000);
    await waitFor('test API ready',  () => client.evaluate(`typeof window.__HEARTHWICK_TEST__ === 'object' ? true : null`), 20000).catch(err => {
        console.error('console logs at failure:', client.consoleLogs.slice(-40).join('\n'));
        throw err;
    });
    return client;
};

const snap     = (c) => c.evaluate('window.__HEARTHWICK_TEST__.getSnapshot()');
const cmd      = (c, s) => c.evaluate(`window.__HEARTHWICK_TEST__.issueCommand(${JSON.stringify(s)})`);
const step     = (c, dx, dy) => c.evaluate(`window.__HEARTHWICK_TEST__.step(${JSON.stringify(dx)}, ${JSON.stringify(dy)})`);
const iceStats = (c) => c.evaluate('window.__realWebRTCStats');

// ── Timing budgets ────────────────────────────────────────────────────────────
const PEER_DISCOVERY_MS  = 6000;  // ICE + presence handshake
const MOVE_PROPAGATION_MS = 2000;
const NAME_PROPAGATION_MS = 2000;

// ── Main ──────────────────────────────────────────────────────────────────────
let chrome, server, pageA, pageB;

try {
    console.log('Building e2e bundle…');
    const { execSync } = await import('node:child_process');
    execSync('npm run build:e2e', { stdio: 'inherit', cwd: root });

    console.log('Starting Chrome + HTTP server…');
    const [served, chr] = await Promise.all([serveDist(), startChrome()]);
    server = served.server;
    chrome = chr;

    // ?transport=real → installRealWebRTCTransport() (real ICE, no torrent trackers)
    const base = `${served.baseUrl}/e2e.html?e2e=1&transport=real&debugnet=1`;
    const urlA = `${base}&scope=peer-a&peer=peer-a&name=Alpha`;
    const urlB = `${base}&scope=peer-b&peer=peer-b&name=Beta`;

    // Start both tabs' navigation simultaneously so networking begins at the
    // same time — prevents peer A's NETWORK_STARTUP_TURN_FALLBACK_MS timer
    // (3 s) from firing before peer B even loads.
    console.log('Opening two game tabs with real WebRTC transport…');
    const [cdpA, cdpB] = await Promise.all([
        openTabEarly(chrome.endpoint, urlA),
        openTabEarly(chrome.endpoint, urlB),
    ]);
    [pageA, pageB] = await Promise.all([
        waitForTestApi(cdpA),
        waitForTestApi(cdpB),
    ]);

    // ── Wait for both players to boot ─────────────────────────────────────────
    await Promise.all([
        waitFor('peer A ph', async () => (await snap(pageA))?.localPlayer?.ph, 15000),
        waitFor('peer B ph', async () => (await snap(pageB))?.localPlayer?.ph, 15000),
    ]);
    console.log('Both players booted.');

    // ── Test 1: peer discovery via real WebRTC ─────────────────────────────────
    console.log('Waiting for peer discovery over real ICE…');
    const discoveryStart = Date.now();
    await waitFor('mutual peer discovery', async () => {
        const [sA, sB] = await Promise.all([snap(pageA), snap(pageB)]);
        const seesB = sA.peers.some(p => p.id === 'peer-b' && !p.ghost);
        const seesA = sB.peers.some(p => p.id === 'peer-a' && !p.ghost);
        return seesA && seesB;
    }, PEER_DISCOVERY_MS);
    const discoveryMs = Date.now() - discoveryStart;
    console.log(`  ✓ Peers discovered each other in ${discoveryMs}ms`);

    // ── Test 1b: verify peers are renderable (location set, ghost=false) ──────
    // world-sync-system filters out peers where p.location !== localPlayer.location || p.ghost
    // so these two conditions gate whether a sprite actually appears on screen.
    {
        const [sA, sB] = await Promise.all([snap(pageA), snap(pageB)]);
        const pBinA = sA.peers.find(p => p.id === 'peer-b');
        const pAinB = sB.peers.find(p => p.id === 'peer-a');
        assert(pBinA && !pBinA.ghost, `peer B is ghost in peer A's view (ghost=${pBinA?.ghost})`);
        assert(pAinB && !pAinB.ghost, `peer A is ghost in peer B's view (ghost=${pAinB?.ghost})`);
        assert(pBinA.location === sA.localPlayer.location,
            `peer B location "${pBinA.location}" ≠ peer A's room "${sA.localPlayer.location}" — sprite would be hidden`);
        assert(pAinB.location === sB.localPlayer.location,
            `peer A location "${pAinB.location}" ≠ peer B's room "${sB.localPlayer.location}" — sprite would be hidden`);
        console.log(`  ✓ Both peers are renderable: location="${pBinA.location}", ghost=false`);
    }

    // ── Test 2: verify ICE connection (not BroadcastChannel fallback) ──────────
    const [statsA, statsB] = await Promise.all([iceStats(pageA), iceStats(pageB)]);
    assert(statsA.connections >= 1, `peer A made ${statsA.connections} WebRTC connections (expected ≥1)`);
    assert(statsB.connections >= 1, `peer B made ${statsB.connections} WebRTC connections (expected ≥1)`);
    assert(statsA.totalCandidates > 0, `peer A gathered no ICE candidates`);
    assert(statsB.totalCandidates > 0, `peer B gathered no ICE candidates`);
    console.log(`  ✓ Real RTCPeerConnection connections: A=${statsA.connections}, B=${statsB.connections}`);
    console.log(`  ✓ ICE candidates: A=${JSON.stringify(statsA.candidatesByType)}, B=${JSON.stringify(statsB.candidatesByType)}`);

    // ── Test 3: name propagation ───────────────────────────────────────────────
    console.log('Testing name propagation…');
    await Promise.all([cmd(pageA, 'rename Alpha'), cmd(pageB, 'rename Beta')]);
    const nameStart = Date.now();
    await waitFor('name propagation', async () => {
        const [sA, sB] = await Promise.all([snap(pageA), snap(pageB)]);
        return sA.peers.some(p => p.id === 'peer-b' && p.name === 'Beta')
            && sB.peers.some(p => p.id === 'peer-a' && p.name === 'Alpha');
    }, NAME_PROPAGATION_MS);
    console.log(`  ✓ Names propagated in ${Date.now() - nameStart}ms`);

    // ── Test 4: movement propagation in the same room ─────────────────────────
    console.log('Testing movement propagation…');
    const snapBeforeMove = await snap(pageA);
    await step(pageA, 1, 0); // move east
    const snapAfterMove = await snap(pageA);
    assert(snapAfterMove.localPlayer.x !== snapBeforeMove.localPlayer.x
        || snapAfterMove.localPlayer.y !== snapBeforeMove.localPlayer.y,
        'peer A position did not change after step()');

    const moveStart = Date.now();
    await waitFor('movement propagated to B', async () => {
        const sB = await snap(pageB);
        return sB.peers.find(p =>
            p.id === 'peer-a'
            && p.x === snapAfterMove.localPlayer.x
            && p.y === snapAfterMove.localPlayer.y
        );
    }, MOVE_PROPAGATION_MS);
    console.log(`  ✓ Movement propagated in ${Date.now() - moveStart}ms`);

    // ── Test 5: move B and verify A sees it ───────────────────────────────────
    const snapBBefore = await snap(pageB);
    await step(pageB, 0, 1); // move south
    const snapBAfter = await snap(pageB);
    assert(snapBAfter.localPlayer.x !== snapBBefore.localPlayer.x
        || snapBAfter.localPlayer.y !== snapBBefore.localPlayer.y,
        'peer B position did not change after step()');

    const moveBStart = Date.now();
    await waitFor('B movement propagated to A', async () => {
        const sA = await snap(pageA);
        return sA.peers.find(p =>
            p.id === 'peer-b'
            && p.x === snapBAfter.localPlayer.x
            && p.y === snapBAfter.localPlayer.y
        );
    }, MOVE_PROPAGATION_MS);
    console.log(`  ✓ Peer B movement propagated in ${Date.now() - moveBStart}ms`);

    // ── Final summary ─────────────────────────────────────────────────────────
    const srflxA = statsA.candidatesByType?.srflx ?? 0;
    const srflxB = statsB.candidatesByType?.srflx ?? 0;
    const srflxNote = (srflxA > 0 && srflxB > 0)
        ? 'STUN server-reflexive candidates confirmed on both peers.'
        : 'WARNING: No srflx candidates — STUN may be unreachable in this environment (host-only connection).';

    console.log('\n✓ ICE game integration test PASSED\n');
    console.log(JSON.stringify({
        discoveryMs,
        transport: 'real-webrtc (ICE/STUN, no torrent trackers)',
        peerA: { iceStats: statsA },
        peerB: { iceStats: statsB },
        srflxNote,
    }, null, 2));

} catch (err) {
    console.error('\n✗ ICE game integration test FAILED');
    console.error(err.message);
    const dumpSnap = async (page, label) => {
        if (!page) return;
        const s = await page.evaluate('window.__HEARTHWICK_TEST__?.getSnapshot() ?? null').catch(() => null);
        const stats = await page.evaluate('window.__realWebRTCStats ?? null').catch(() => null);
        console.error(`${label}:`, JSON.stringify({ snapshot: s, iceStats: stats }, null, 2));
        console.error(`${label} console (last 40):`, page.consoleLogs?.slice(-40).join('\n') ?? '');
    };
    await dumpSnap(pageA, 'peer A');
    await dumpSnap(pageB, 'peer B');
    process.exit(1);
} finally {
    await pageA?.close();
    await pageB?.close();
    if (chrome?.child) chrome.child.kill('SIGTERM');
    if (chrome?.userDataDir) await rm(chrome.userDataDir, { recursive: true, force: true }).catch(() => {});
    if (server) await new Promise(r => server.close(r));
}

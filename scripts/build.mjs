// Builds the main client bundle. Uses esbuild's JS API (instead of the CLI one-liner) so TURN
// credentials can be injected from CI secrets (METERED_TURN_USERNAME / METERED_TURN_CREDENTIAL) at
// build time via `define` — keeping them out of source/git. When the secrets aren't set (local/dev),
// the defines are empty strings and the app runs STUN-only. See src/infra/constants.js (TURN_SERVERS).
import { build } from 'esbuild';
import { copyFileSync } from 'node:fs';

const turnUser = process.env.METERED_TURN_USERNAME || '';
const turnCred = process.env.METERED_TURN_CREDENTIAL || '';
if (!turnUser || !turnCred) {
    console.warn('[build] METERED_TURN_USERNAME/CREDENTIAL not set — building STUN-only (no TURN relay).');
}

await build({
    entryPoints: ['src/main.js'],
    bundle: true,
    minify: true,
    loader: { '.wasm': 'dataurl' },
    external: ['crypto'],
    outfile: 'dist/main.js',
    define: {
        __TURN_USER__: JSON.stringify(turnUser),
        __TURN_CRED__: JSON.stringify(turnCred),
    },
});

for (const f of ['index.html', 'manifest.json', 'styles.css']) {
    copyFileSync(`src/${f}`, `dist/${f}`);
}
console.log(`[build] dist/main.js built ${turnUser ? '(TURN injected)' : '(STUN-only)'}`);

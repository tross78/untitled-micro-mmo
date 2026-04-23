#!/bin/bash
# Hearthwick pre-submit verification. Run before finishing any task.
# Usage: npm run verify
set -e

echo "--- [1/4] Running tests..."
npm test --silent
echo "    All tests passed."

echo "--- [2/4] Building bundle..."
npm run build --silent
SIZE=$(wc -c < dist/main.js)
LIMIT=179200  # 175KB in bytes
if [ "$SIZE" -gt "$LIMIT" ]; then
    echo "    FAIL: Bundle too large: ${SIZE}B (limit ${LIMIT}B)"
    exit 1
fi
echo "    Bundle OK: ${SIZE}B"

echo "--- [3/4] Checking critical imports in main.js..."
node --input-type=module << 'EOF'
import { readFileSync } from 'node:fs';
const src = readFileSync('src/main.js', 'utf8');
const match = src.match(/import\s*\{([^}]*)\}\s*from\s*['"]\.\/rules['"]/s);
if (!match) { console.error("    FAIL: No import from './rules' found in main.js"); process.exit(1); }
const required = ['getShardName', 'INSTANCE_CAP'];
const missing = required.filter(n => !match[1].includes(n));
if (missing.length > 0) { console.error("    FAIL: Missing from rules import: " + missing.join(', ')); process.exit(1); }
EOF
echo "    Imports OK."

echo "--- [4/4] Checking for forbidden patterns..."
# Math.random() is banned in simulation/client code (use seededRNG instead).
# Exception: arbiter/index.js uses it only to generate initial world_seed entropy — that's allowed.
if grep -n "Math\.random()" src/rules.js src/main.js 2>/dev/null; then
    echo "    FAIL: Math.random() found in client/rules code — use seededRNG(hashStr(...)) instead"
    exit 1
fi
# createMerkleRoot must NOT be in the top-level import in main.js
if grep "import.*createMerkleRoot.*from './crypto'" src/main.js 2>/dev/null; then
    echo "    FAIL: createMerkleRoot must be lazy-imported inside the rollup interval, not at top level"
    exit 1
fi
echo "    No forbidden patterns found."

echo ""
echo "All checks passed. Safe to submit."

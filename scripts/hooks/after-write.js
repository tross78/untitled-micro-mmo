/**
 * Gemini CLI AfterTool hook — fires after every write_file or edit_file call.
 *
 * Reads the tool result from stdin (JSON), checks if a source file was written,
 * and injects a reminder into stdout for Gemini to run npm test.
 *
 * Gemini CLI hook protocol:
 *   - stdin:  JSON tool result
 *   - stdout: JSON with optional { "message": string } to inject into context
 *   - Non-zero exit: signals the tool result should be flagged
 */

import { readFileSync } from 'node:fs';

const input = JSON.parse(readFileSync('/dev/stdin', 'utf8'));
const filePath = input?.toolInput?.path || input?.toolInput?.file_path || '';

const isSrc = filePath.match(/\.(js|mjs|cjs)$/) && !filePath.includes('node_modules');

if (isSrc) {
    const output = {
        message: [
            `File written: ${filePath}`,
            `REMINDER: Run \`npm test\` now to verify no tests broke.`,
            `If tests fail, run \`npm run diagnose\` for structured error output — do not guess at the cause.`,
            `If the same fix fails twice, stop and follow the Loop Prevention Protocol in GEMINI.md.`,
            `Also check: are all symbols you used actually imported at the top of the file?`,
        ].join('\n')
    };
    process.stdout.write(JSON.stringify(output));
}

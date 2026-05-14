import { validateContent } from '../src/content/validate.js';
import * as defs from '../src/content/index.js';

const result = validateContent(defs);
const processRef = globalThis.process;

if (!result.ok) {
  console.error('Content validation failed:');
  result.problems.forEach((problem) => console.error(`- ${problem}`));
  processRef?.exit?.(1);
}

console.log(`Content validation passed (${result.problems.length} issues).`);

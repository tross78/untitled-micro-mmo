import { validateContent } from '../src/content/validate.js';

const result = validateContent();
const processRef = globalThis.process;

if (!result.ok) {
  console.error('Content validation failed:');
  result.problems.forEach((problem) => console.error(`- ${problem}`));
  processRef?.exit?.(1);
}

console.log(`Content validation passed (${result.problems.length} issues).`);

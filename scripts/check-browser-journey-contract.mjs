import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const browserDir = fileURLToPath(new URL('../tests/browser/', import.meta.url));
const helperFile = path.join(browserDir, 'journey-helpers.mjs');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return /\.(?:[cm]?js|ts)$/.test(entry.name) ? [fullPath] : [];
  });
}

function lineNumber(source, index) {
  return source.slice(0, index).split('\n').length;
}

const rules = [
  {
    pattern: /\.click\s*\(/g,
    message: 'Direct .click() calls are forbidden in browser specs. Use userClick() or openDetails() from journey-helpers.mjs so reachability is checked first.',
  },
  {
    pattern: /\bforce\s*:\s*true\b/g,
    message: 'Forced interactions are forbidden because they can make an unreachable control look usable.',
  },
  {
    pattern: /\.dispatchEvent\s*\(\s*['"]click['"]/g,
    message: 'Synthetic click dispatch is forbidden because it bypasses the real user interaction path.',
  },
  {
    pattern: /\.evaluate(?:Handle)?\s*\([\s\S]{0,300}?\.click\s*\(/g,
    message: 'DOM clicks from evaluate/evaluateHandle are forbidden because they bypass visibility and reachability.',
  },
];

const violations = [];
const files = walk(browserDir).filter((file) => path.resolve(file) !== path.resolve(helperFile));

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    for (let match = rule.pattern.exec(source); match; match = rule.pattern.exec(source)) {
      const line = lineNumber(source, match.index);
      const lineText = source.split('\n')[line - 1]?.trim() || '';
      if (lineText.startsWith('//') || lineText.startsWith('*')) continue;
      violations.push(`${path.relative(process.cwd(), file)}:${line} — ${rule.message}`);
    }
  }
}

if (violations.length) {
  console.error('Browser journey interaction contract failed:\n');
  for (const violation of violations) console.error(`- ${violation}`);
  console.error('\nBrowser tests must model controls a user can actually reach. Do not bypass hidden, collapsed, off-screen, or disabled states.');
  process.exit(1);
}

console.log(`Browser journey interaction contract OK (${files.length} browser spec file${files.length === 1 ? '' : 's'} checked).`);

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const docsDir = path.join(root, 'docs');
const pageScripts = new Map([
  ['add.html', 'add.js'],
  ['admin.html', 'admin.js'],
  ['index.html', 'app.js'],
  ['planner.html', 'planner.js'],
  ['bread-maker.html', 'bread-maker.js'],
  ['recipe.html', 'recipe.js'],
]);

const statefulTags = new Set(['aside', 'details', 'dialog', 'div', 'form', 'nav', 'section']);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasHiddenAttribute(tagSource) {
  return /\s+hidden(?:\s*=\s*(?:["']?hidden["']?|["']["']))?(?=\s|\/?>)/i.test(tagSource);
}

function revealPathExists(script, id) {
  const escapedId = escapeRegExp(id);
  const variablePatterns = [
    new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*document\\.getElementById\\(\\s*["']${escapedId}["']\\s*\\)`, 'g'),
    new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*document\\.querySelector\\(\\s*["']#${escapedId}["']\\s*\\)`, 'g'),
  ];

  const names = new Set();
  for (const pattern of variablePatterns) {
    for (let match = pattern.exec(script); match; match = pattern.exec(script)) names.add(match[1]);
  }

  const directId = `(?:document\\.getElementById\\(\\s*["']${escapedId}["']\\s*\\)|document\\.querySelector\\(\\s*["']#${escapedId}["']\\s*\\))`;
  const targets = [directId, ...Array.from(names, (name) => `\\b${escapeRegExp(name)}`)];

  return targets.some((target) => {
    const reveals = [
      new RegExp(`${target}\\.hidden\\s*=\\s*(?!true\\b)[^;\\n]+`),
      new RegExp(`${target}\\.removeAttribute\\(\\s*["']hidden["']\\s*\\)`),
      new RegExp(`${target}\\.toggleAttribute\\(\\s*["']hidden["']\\s*,\\s*(?!true\\b)[^)]+\\)`),
    ];
    return reveals.some((pattern) => pattern.test(script));
  });
}

const violations = [];

for (const [htmlName, scriptName] of pageScripts) {
  const html = fs.readFileSync(path.join(docsDir, htmlName), 'utf8');
  const script = fs.readFileSync(path.join(docsDir, scriptName), 'utf8');
  const tagPattern = /<([a-z][\w-]*)\b[^>]*>/gi;

  for (let match = tagPattern.exec(html); match; match = tagPattern.exec(html)) {
    const tag = match[1].toLowerCase();
    const source = match[0];
    if (!statefulTags.has(tag) || !hasHiddenAttribute(source)) continue;

    const idMatch = source.match(/\bid=["']([^"']+)["']/i);
    if (!idMatch) {
      violations.push(`${htmlName}: hidden <${tag}> has no id, so its active state cannot be audited. Remove it or give the active state an explicit owner.`);
      continue;
    }

    const id = idMatch[1];
    if (!revealPathExists(script, id)) {
      violations.push(
        `${htmlName}#${id}: hidden UI has no explicit reveal path in ${scriptName}. ` +
          'If the feature is no longer used, delete its markup/code/styles instead of leaving dormant architecture in the page.'
      );
    }
  }
}

if (violations.length) {
  console.error('UI state ownership contract failed:\n');
  for (const violation of violations) console.error(`- ${violation}`);
  console.error(
    '\nThe hidden attribute is reserved for reversible states in active user workflows. ' +
      'Unavailable, retired, or not-applicable systems should not remain in the DOM.'
  );
  process.exit(1);
}

console.log('UI state ownership contract OK: every hidden stateful system has an explicit runtime path that can reveal it.');

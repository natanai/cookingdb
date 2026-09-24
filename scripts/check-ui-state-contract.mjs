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

// Hidden state is an architectural exception, not a parking place for old UI.
// Every entry here must describe a reversible state in a current user workflow.
// If the feature goes away, delete the markup/handlers/styles AND this entry.
// If a new hidden state is introduced, its purpose must be reviewed here explicitly.
const approvedHiddenStates = new Map([
  [
    'add.html',
    new Map([
      ['admin-edit-banner', 'Shown only while the Add Recipe composer is reviewing an existing pending inbox recipe.'],
      ['review-panel', 'Shown when the author explicitly enters the Review recipe state, then hidden on return to editing.'],
    ]),
  ],
  [
    'admin.html',
    new Map([
      ['pending-section', 'Shown after authenticated pending recipes are loaded into the Recipe inbox.'],
    ]),
  ],
  [
    'planner.html',
    new Map([
      ['custom-fields', 'Shown only when the user enables custom day/meal counts.'],
      ['planner-selected-section', 'Shown once the user adds at least one recipe to the plan.'],
      ['planner-ingredients-section', 'Shown once a plan exists and therefore has a grocery list.'],
      ['planner-nutrition-banner', 'Shown only when the active optional nutrition analysis has a warning to communicate.'],
    ]),
  ],
  [
    'recipe.html',
    new Map([
      ['multiplier-helper', 'Shown when batch-scaling state needs an explanatory status.'],
      ['recipe-data-warning', 'Shown only when the loaded recipe has a recoverable data warning.'],
      ['available-scale-panel', 'Shown after the user opens Use what I have.'],
      ['available-scale-active', 'Shown while an ingredient-availability scaling adjustment is active.'],
      ['pan-controls', 'Shown only for recipes that actually support pan-size scaling.'],
      ['nutrition-coverage-banner', 'Shown when the active nutrition feature has incomplete-coverage information.'],
      ['recipe-nutrition', 'Shown only when nutrition information is available for the loaded recipe.'],
      ['print-notes-section', 'Shown in the print document only when the recipe has a cook note to print.'],
    ]),
  ],
]);

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
const discoveredHiddenStates = new Map();

for (const [htmlName, scriptName] of pageScripts) {
  const html = fs.readFileSync(path.join(docsDir, htmlName), 'utf8');
  const script = fs.readFileSync(path.join(docsDir, scriptName), 'utf8');
  const tagPattern = /<([a-z][\w-]*)\b[^>]*>/gi;
  const discovered = new Set();
  discoveredHiddenStates.set(htmlName, discovered);

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
    discovered.add(id);

    const approval = approvedHiddenStates.get(htmlName)?.get(id);
    if (!approval) {
      violations.push(
        `${htmlName}#${id}: hidden stateful UI is not an approved current workflow state. ` +
          'Delete obsolete/not-applicable UI instead of hiding it, or explicitly document the reversible active state in check-ui-state-contract.mjs.'
      );
    }

    if (!revealPathExists(script, id)) {
      violations.push(
        `${htmlName}#${id}: hidden UI has no explicit reveal path in ${scriptName}. ` +
          'If the feature is no longer used, delete its markup/code/styles instead of leaving dormant architecture in the page.'
      );
    }
  }
}

for (const [htmlName, approvals] of approvedHiddenStates) {
  const discovered = discoveredHiddenStates.get(htmlName) || new Set();
  for (const [id, reason] of approvals) {
    if (!reason.trim()) {
      violations.push(`${htmlName}#${id}: approved hidden state is missing a concrete workflow reason.`);
    }
    if (!discovered.has(id)) {
      violations.push(
        `${htmlName}#${id}: hidden-state approval is stale because the element no longer exists as hidden stateful UI. ` +
          'Remove the approval along with the retired architecture.'
      );
    }
  }
}

if (violations.length) {
  console.error('UI state ownership contract failed:\n');
  for (const violation of violations) console.error(`- ${violation}`);
  console.error(
    '\nThe hidden attribute is reserved for reviewed, reversible states in active user workflows. ' +
      'Unavailable, retired, or not-applicable systems should not remain in the DOM.'
  );
  process.exit(1);
}

const approvedCount = Array.from(approvedHiddenStates.values()).reduce(
  (total, pageStates) => total + pageStates.size,
  0
);
console.log(
  `UI state ownership contract OK: ${approvedCount} hidden stateful systems are explicitly reviewed current workflow states with runtime reveal paths; unregistered or stale hidden architecture fails CI.`
);

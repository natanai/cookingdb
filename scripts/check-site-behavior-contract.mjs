import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const docsDir = path.join(root, 'docs');

const pages = [
  { html: 'index.html', script: 'app.js', page: 'home' },
  { html: 'recipe.html', script: 'recipe.js', page: 'recipe' },
  { html: 'add.html', script: 'add.js', page: 'add' },
  { html: 'planner.html', script: 'planner.js', page: 'planner' },
  { html: 'bread-maker.html', script: 'bread-maker.js', page: 'bread' },
  { html: 'admin.html', script: 'admin.js', page: 'admin' },
];

function fail(message) {
  throw new Error(`Site behavior contract: ${message}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

const actualHtmlPages = fs
  .readdirSync(docsDir)
  .filter((name) => name.endsWith('.html'))
  .sort();

const expectedHtmlPages = pages.map((entry) => entry.html).sort();
assert(
  JSON.stringify(actualHtmlPages) === JSON.stringify(expectedHtmlPages),
  `top-level HTML page inventory changed. Expected ${expectedHtmlPages.join(', ')}; got ${actualHtmlPages.join(', ')}. Register new pages with the shared behavior manager.`
);

for (const entry of pages) {
  const htmlPath = path.join(docsDir, entry.html);
  const scriptPath = path.join(docsDir, entry.script);
  const html = fs.readFileSync(htmlPath, 'utf8');
  const script = fs.readFileSync(scriptPath, 'utf8');

  assert(
    /<meta\s+name=["']viewport["']\s+content=["'][^"']*width=device-width[^"']*initial-scale=1(?:\.0)?[^"']*["']\s*\/?\s*>/i.test(html),
    `${entry.html} must use the shared viewport contract`
  );

  const bodyMatch = html.match(/<body\b([^>]*)>/i);
  assert(bodyMatch, `${entry.html} is missing <body>`);
  assert(
    new RegExp(`data-site-page=["']${entry.page}["']`).test(bodyMatch[1]),
    `${entry.html} must declare data-site-page="${entry.page}"`
  );

  const navMatch = html.match(/<nav\b([^>]*)>([\s\S]*?)<\/nav>/i);
  assert(navMatch, `${entry.html} is missing its site navigation container`);
  assert(
    /\bdata-site-nav\b/.test(navMatch[1]),
    `${entry.html} navigation must be owned by data-site-nav`
  );
  assert(
    !/<a\b/i.test(navMatch[2]),
    `${entry.html} must not hard-code primary navigation links; site-behavior.js owns the menu`
  );

  const scriptTagPattern = new RegExp(
    `<script\\b[^>]*src=["']${entry.script.replace('.', '\\.') }["'][^>]*><\\/script>`,
    'i'
  );
  assert(scriptTagPattern.test(html), `${entry.html} must load ${entry.script}`);

  assert(
    script.includes("from './site-behavior.js'"),
    `${entry.script} must import the shared site behavior manager`
  );

  const forbidden = [
    ['matchMedia', /\bmatchMedia\s*\(/],
    ['visualViewport', /\bvisualViewport\b/],
    ['window resize listener', /window\.addEventListener\(\s*['"]resize['"]/],
    ['window scroll listener', /window\.addEventListener\(\s*['"]scroll['"]/],
    ['orientationchange listener', /addEventListener\(\s*['"]orientationchange['"]/],
  ];

  for (const [label, pattern] of forbidden) {
    assert(
      !pattern.test(script),
      `${entry.script} contains its own ${label}; route environmental behavior through site-behavior.js`
    );
  }
}

const manager = fs.readFileSync(path.join(docsDir, 'site-behavior.js'), 'utf8');
for (const required of [
  "window.matchMedia('(pointer: coarse)')",
  "window.matchMedia('(prefers-reduced-motion: reduce)')",
  "window.matchMedia('(max-width: 700px)')",
  'window.visualViewport',
  "window.addEventListener('resize'",
  "window.addEventListener('scroll'",
  'renderNavigation()',
  'installPressFeedback',
]) {
  assert(manager.includes(required), `site-behavior.js is missing required behavior: ${required}`);
}

for (const label of ['Cookbook', 'Bread maker', 'Meal prep planner', 'Add recipe']) {
  assert(manager.includes(`label: '${label}'`), `site-behavior.js is missing canonical nav item ${label}`);
}

const css = fs.readFileSync(path.join(docsDir, 'styles.css'), 'utf8');
assert(
  /@media\s*\(hover:\s*none\)\s*and\s*\(pointer:\s*coarse\)[\s\S]*font-size:\s*16px\s*!important/m.test(css),
  'styles.css must keep touch form controls at the no-focus-zoom 16px floor'
);
assert(
  /\.nav-links[\s\S]*overflow-x:\s*auto/m.test(css),
  'styles.css must keep compact navigation available through horizontal overflow'
);
assert(
  /\.nav-links \.button[\s\S]*min-height:\s*44px/m.test(css),
  'styles.css must keep managed navigation targets comfortably tappable'
);
assert(
  !/body\.add-page \.nav-links/.test(css),
  'page-specific add-page navigation overrides are not allowed; the shared shell owns nav behavior'
);

console.log(
  `Site behavior contract OK: deterministically checked ${pages.length} pages, their page scripts, the shared behavior manager, and the shared mobile shell.`
);

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

for (const label of ['Cookbook', 'Add recipe', 'Meal prep planner', 'Bread maker']) {
  assert(manager.includes(`label: '${label}'`), `site-behavior.js is missing canonical nav item ${label}`);
}

for (const icon of ["icon: 'book'", "icon: 'plus'", "icon: 'calendar'", "icon: 'bread'", "gear:"]) {
  assert(manager.includes(icon), `site-behavior.js is missing canonical icon navigation: ${icon}`);
}

assert(
  !manager.includes(".filter((item) => item.key !== page)"),
  'primary navigation must keep every destination in a fixed slot even on the current page'
);
assert(
  manager.includes("link.setAttribute('aria-current', 'page')"),
  'the current destination must be indicated in-place instead of removed from navigation'
);
assert(
  manager.includes("inbox.id = 'admin-inbox-link'") && manager.includes("inbox.textContent = 'Recipe inbox'"),
  'admin-only recipe inbox access must live under the shared gear menu'
);
assert(
  manager.includes("{ key: 'home', href: 'index.html', label: 'Cookbook', icon: 'book', iconOnlyWide: true }"),
  'Cookbook must remain the icon-only persistent home anchor'
);

const css = fs.readFileSync(path.join(docsDir, 'styles.css'), 'utf8');
assert(
  /@media\s*\(hover:\s*none\)\s*and\s*\(pointer:\s*coarse\)[\s\S]*font-size:\s*16px\s*!important/m.test(css),
  'styles.css must keep touch form controls at the no-focus-zoom 16px floor'
);
assert(
  /grid-template-columns:\s*repeat\(5,\s*(?:38|40)px\)/m.test(css),
  'compact navigation must expose all five fixed destinations without horizontal scrolling'
);
assert(
  /\.nav-links[\s\S]*overflow:\s*visible/m.test(css),
  'compact navigation must not require a sideways swipe'
);
assert(
  /\.site-nav-item[\s\S]*height:\s*40px/m.test(css),
  'managed navigation targets must remain comfortably tappable'
);
assert(
  /\.site-nav-label\[data-compact-hidden=['"]true['"]\][\s\S]*display:\s*none/m.test(css),
  'compact navigation must switch to icon-first labels rather than overflow'
);
assert(
  !/body\.add-page \.nav-links/.test(css),
  'page-specific add-page navigation overrides are not allowed; the shared shell owns nav behavior'
);
assert(
  /\.site-header \.site-title\s*\{[\s\S]*display:\s*none\s*!important/m.test(css),
  'the app bar must not display a product/site name'
);
assert(
  /\.site-nav-item\[data-site-nav-key=['"]home['"]\][\s\S]*margin-right:\s*auto/m.test(css),
  'the Cookbook icon must stay left-anchored while tools remain on the right'
);

const recipeHtml = fs.readFileSync(path.join(docsDir, 'recipe.html'), 'utf8');
const recipeTitleIndex = recipeHtml.indexOf('id="recipe-title"');
const recipeMetaIndex = recipeHtml.indexOf('recipe-meta-primary');
const ingredientsIndex = recipeHtml.indexOf('class="ingredients-section"');
const stepsIndex = recipeHtml.indexOf('class="steps-section"');
const detailsIndex = recipeHtml.indexOf('class="recipe-details-panel"');
const nutritionIndex = recipeHtml.indexOf('id="nutrition-coverage-banner"');

assert(recipeTitleIndex >= 0, 'recipe page must render its title in the recipe document');
assert(
  recipeTitleIndex < recipeMetaIndex && recipeMetaIndex < ingredientsIndex,
  'recipe title and compact dietary/family metadata must lead directly into ingredients'
);
assert(
  ingredientsIndex < stepsIndex && stepsIndex < detailsIndex,
  'recipe reading order must be ingredients, steps, then secondary details'
);
assert(
  nutritionIndex > stepsIndex,
  'nutrition warnings/details must not stand between the user and the recipe'
);
assert(
  !/<section class=["']controls["']/.test(recipeHtml),
  'recipe page must not restore the large pre-recipe controls card'
);

const plannerHtml = fs.readFileSync(path.join(docsDir, 'planner.html'), 'utf8');
const plannerIntroIndex = plannerHtml.indexOf('class="planner-intro"');
const plannerPlanIndex = plannerHtml.indexOf('class="planner-plan planner-surface"');
const plannerPickerIndex = plannerHtml.indexOf('class="planner-picker planner-surface"');
const plannerSelectedIndex = plannerHtml.indexOf('id="planner-selected-section"');
const plannerIngredientsIndex = plannerHtml.indexOf('id="planner-ingredients-section"');
const plannerSecondaryIndex = plannerHtml.indexOf('class="planner-secondary planner-surface"');
const plannerNutritionBannerIndex = plannerHtml.indexOf('id="planner-nutrition-banner"');

assert(
  plannerIntroIndex >= 0 &&
    plannerIntroIndex < plannerPlanIndex &&
    plannerPlanIndex < plannerPickerIndex &&
    plannerPickerIndex < plannerSelectedIndex &&
    plannerSelectedIndex < plannerIngredientsIndex &&
    plannerIngredientsIndex < plannerSecondaryIndex,
  'meal prep must follow the task order: intro, plan, choose recipes, selected plan, grocery list, optional details'
);
assert(
  plannerNutritionBannerIndex > plannerSecondaryIndex,
  'nutrition warnings must live inside optional planner details rather than interrupting the primary workflow'
);
assert(
  plannerHtml.includes('id="planner-progress"') && plannerHtml.includes('id="planner-progress-fill"'),
  'meal prep must show compact progress instead of three oversized metric blocks'
);
assert(
  !plannerHtml.includes('class="hero planner-hero"'),
  'meal prep must not restore the oversized marketing-style hero'
);

console.log(
  `Site behavior contract OK: deterministically checked ${pages.length} pages, fixed icon navigation, recipe-first ordering, planner task flow, their page scripts, the shared behavior manager, and the shared mobile shell.`
);

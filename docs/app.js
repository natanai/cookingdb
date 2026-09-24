import { siteBehavior } from './site-behavior.js';
import { builtDataUrl } from './built-data.js';
import { buildRecipeLink, getRecipeTitleParts } from './recipe-model.js';
import { loadRecipeSummaries } from './recipe-repository.js';

const HAPTICS_KEY = 'cookingdb-ruffle-haptics';
const HIDDEN_HOME_CATEGORIES = new Set(['Bread maker']);
const RECIPE_WARM_RESOURCES = Object.freeze([
  './recipe.html',
  './recipe.js',
  './nutrition-engine.js',
  './built-data.js',
  './built/recipes.json',
  './built/nutrition-policy.json',
  './built/nutrition-guidelines.json',
  './built/ingredient-portions.json',
  './built/ingredient-unit-factors.json',
  './built/nutrition-coverage.json',
]);

let recipeWarmPromise = null;
let recipeWarmReady = false;
let recipeList = [];
let selectedCategory = 'all';
let ruffleObserver = null;
let lastHapticAt = 0;
let mobileRuffleInstalled = false;
let mobileRuffleUpdate = null;

function canUseRuffleHaptics() {
  const { coarsePointer, reducedMotion } = siteBehavior.state;
  const supportsVibrate =
    typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  return !!(coarsePointer && supportsVibrate && !reducedMotion);
}

function isRuffleEnabled() {
  const stored = localStorage.getItem(HAPTICS_KEY);
  return stored === null ? true : stored === 'true';
}

function setRuffleEnabled(value) {
  localStorage.setItem(HAPTICS_KEY, value ? 'true' : 'false');
}

function tinyHapticPulse() {
  if (!canUseRuffleHaptics() || !isRuffleEnabled() || !siteBehavior.hasUserInteracted) return;
  if (document.visibilityState !== 'visible') return;

  const now = Date.now();
  if (now - lastHapticAt < 120) return;
  lastHapticAt = now;
  navigator.vibrate(5);
}

function setupRuffleObserver(listEl) {
  if (ruffleObserver) {
    ruffleObserver.disconnect();
    ruffleObserver = null;
  }
  if (!canUseRuffleHaptics()) return;

  ruffleObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) tinyHapticPulse();
      }
    },
    {
      root: null,
      rootMargin: '-45% 0px -45% 0px',
      threshold: 0.01,
    }
  );

  listEl.querySelectorAll('li.recipe-row').forEach((row) => ruffleObserver.observe(row));
}

function setupMobileScrollRuffle() {
  const listEl = document.getElementById('recipe-list');
  if (!listEl) return;

  const { coarsePointer, reducedMotion } = siteBehavior.state;
  if (!coarsePointer || reducedMotion) return;

  let rows = Array.from(listEl.querySelectorAll('li.recipe-row'));
  if (!rows.length && mobileRuffleInstalled) {
    requestAnimationFrame(() => mobileRuffleUpdate?.());
    return;
  }

  let ticking = false;

  function update() {
    ticking = false;
    rows = Array.from(listEl.querySelectorAll('li.recipe-row'));
    if (!rows.length) return;

    const focusY = Math.round(window.innerHeight * 0.42);
    const maxDist = Math.max(180, Math.round(window.innerHeight * 0.32));
    let bestIdx = -1;
    let bestT = 0;

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const rect = row.getBoundingClientRect();

      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        row.style.setProperty('--ruffle', '0');
        row.style.setProperty('--ruffle-near', '0');
        continue;
      }

      const centerY = rect.top + rect.height / 2;
      const proximity = Math.max(0, 1 - Math.abs(centerY - focusY) / maxDist);
      const eased = proximity * proximity;
      row.style.setProperty('--ruffle', eased.toFixed(3));
      row.style.setProperty('--ruffle-near', '0');

      if (eased > bestT) {
        bestT = eased;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      const previous = rows[bestIdx - 1];
      const next = rows[bestIdx + 1];
      if (previous) previous.style.setProperty('--ruffle-near', (bestT * 0.55).toFixed(3));
      if (next) next.style.setProperty('--ruffle-near', (bestT * 0.55).toFixed(3));
    }
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }

  if (!mobileRuffleInstalled) {
    siteBehavior.onScrollFrame(onScroll);
    siteBehavior.onViewportChange(onScroll, { immediate: false });
    mobileRuffleInstalled = true;
  }

  mobileRuffleUpdate = update;
  requestAnimationFrame(update);
}

async function loadIndex() {
  return loadRecipeSummaries({ label: 'Cookbook index' });
}

async function warmRecipeResource(url) {
  const requestUrl = url.startsWith('./built/') ? builtDataUrl(url) : url;
  const response = await fetch(requestUrl, {
    credentials: 'same-origin',
    cache: 'default',
  });
  if (!response.ok) throw new Error(`Unable to warm ${url} (${response.status})`);
  await response.arrayBuffer();
}

function warmRecipeExperience() {
  if (recipeWarmPromise) return recipeWarmPromise;

  recipeWarmPromise = Promise.allSettled(
    RECIPE_WARM_RESOURCES.map((url) => warmRecipeResource(url))
  ).then((results) => {
    recipeWarmReady = results.every((result) => result.status === 'fulfilled');
    return recipeWarmReady;
  });

  return recipeWarmPromise;
}

function scheduleRecipeWarmup() {
  window.requestAnimationFrame(() => {
    window.setTimeout(() => {
      void warmRecipeExperience();
    }, 0);
  });
}

function isPlainRecipeNavigation(event, link) {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    !link.target &&
    link.href
  );
}

function installWarmRecipeNavigation(link) {
  link.addEventListener('click', async (event) => {
    if (!isPlainRecipeNavigation(event, link) || recipeWarmReady) return;

    event.preventDefault();
    const destination = link.href;
    link.setAttribute('aria-busy', 'true');

    try {
      await warmRecipeExperience();
    } finally {
      window.location.assign(destination);
    }
  });
}

function recipeSummary(recipe) {
  return {
    id: recipe.id,
    title: recipe.title,
    byline: recipe.byline || '',
    categories: recipe.categories || [],
    family: recipe.family || '',
    compatibility_possible: recipe.compatibility_possible || {
      gluten_free: true,
      egg_free: true,
      dairy_free: true,
    },
    content_hash: recipe.content_hash,
  };
}

function recipeVisible(recipe, filters) {
  if (
    filters.category === 'all' &&
    (recipe.categories || []).some((category) => HIDDEN_HOME_CATEGORIES.has(category))
  ) {
    return false;
  }

  const matchesCategory =
    filters.category === 'all' ||
    (recipe.categories || []).includes(filters.category) ||
    (recipe.family && recipe.family === filters.category);
  if (!matchesCategory) return false;

  if (filters.query) {
    const inTitle = (recipe.title || '').toLowerCase().includes(filters.query);
    const inCategories = (recipe.categories || []).some((cat) =>
      cat.toLowerCase().includes(filters.query)
    );
    const inFamily = (recipe.family || '').toLowerCase().includes(filters.query);
    const inByline = (recipe.byline || '').toLowerCase().includes(filters.query);
    if (!inTitle && !inCategories && !inFamily && !inByline) return false;
  }

  const compatibility = recipe.compatibility_possible || {};
  if (filters.gluten && !compatibility.gluten_free) return false;
  if (filters.egg && !compatibility.egg_free) return false;
  if (filters.dairy && !compatibility.dairy_free) return false;
  return true;
}

function renderRecipes(recipes) {
  const listEl = document.getElementById('recipe-list');
  const filters = {
    gluten: document.getElementById('filter-gluten').checked,
    egg: document.getElementById('filter-egg').checked,
    dairy: document.getElementById('filter-dairy').checked,
    query: document.getElementById('search-input')?.value.trim().toLowerCase() || '',
    category: selectedCategory,
  };

  listEl.replaceChildren();
  const visible = recipes
    .filter((recipe) => recipeVisible(recipe, filters))
    .sort((a, b) =>
      getRecipeTitleParts(a).title.localeCompare(getRecipeTitleParts(b).title, undefined, {
        sensitivity: 'base',
      })
    );

  if (!visible.length) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = 'No recipes match that search just yet—try clearing a filter.';
    listEl.appendChild(empty);
    setupRuffleObserver(listEl);
    setupMobileScrollRuffle();
    return;
  }

  visible.forEach((recipe) => {
    const li = document.createElement('li');
    li.className = 'recipe-row';

    const link = document.createElement('a');
    link.className = 'recipe-row-link';
    link.href = buildRecipeLink(recipe.id);
    siteBehavior.installPressFeedback(link);
    installWarmRecipeNavigation(link);

    const title = document.createElement('span');
    title.className = 'recipe-row-title';

    const titleText = document.createElement('span');
    titleText.className = 'recipe-row-title-text';
    const { title: cleanTitle, name: titleName } = getRecipeTitleParts(recipe);
    titleText.textContent = cleanTitle;
    title.appendChild(titleText);

    if (titleName) {
      const name = document.createElement('span');
      name.className = 'recipe-row-title-name';
      name.textContent = ` — ${titleName}`;
      title.appendChild(name);
    }

    const flags = document.createElement('span');
    flags.className = 'recipe-row-flags';
    flags.setAttribute('aria-label', 'Dietary-friendly indicators');

    const compatibility = recipe.compatibility_possible || {};
    const indicators = [
      ['GF', 'Gluten-free', compatibility.gluten_free],
      ['EF', 'Egg-free', compatibility.egg_free],
      ['DF', 'Dairy-free', compatibility.dairy_free],
    ];

    indicators.forEach(([label, description, supported]) => {
      if (!supported) return;
      const badge = document.createElement('span');
      badge.className = 'recipe-flag';
      badge.textContent = label;
      badge.title = description;
      badge.setAttribute('aria-label', description);
      flags.appendChild(badge);
    });

    link.append(title, flags);
    li.appendChild(link);
    listEl.appendChild(li);
  });

  setupRuffleObserver(listEl);
  setupMobileScrollRuffle();
}

function uniqueCategories(recipes) {
  const categories = new Set();
  recipes.forEach((recipe) => {
    (recipe.categories || []).forEach((category) => categories.add(category));
    if (recipe.family) categories.add(recipe.family);
  });
  return Array.from(categories).sort((a, b) => a.localeCompare(b));
}

function renderCategoryPanel(recipes, onSelect) {
  const panel = document.getElementById('category-panel');
  const optionsContainer = document.getElementById('category-options');
  const currentLabel = document.getElementById('category-current');
  if (!panel || !optionsContainer || !currentLabel) return;

  const categories = ['all', ...uniqueCategories(recipes)];
  optionsContainer.replaceChildren();
  currentLabel.textContent = selectedCategory === 'all' ? 'All recipes' : selectedCategory;

  categories.forEach((category) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'category-option';
    button.dataset.category = category;
    button.setAttribute('aria-pressed', selectedCategory === category ? 'true' : 'false');
    button.textContent = category === 'all' ? 'All recipes' : category;
    button.addEventListener('click', () => {
      selectedCategory = category;
      onSelect?.();
      panel.open = false;
    });
    optionsContainer.appendChild(button);
  });
}

function updateRefineSummary() {
  const summary = document.getElementById('refine-summary-state');
  if (!summary) return;

  const categoryLabel = document.getElementById('category-current')?.textContent?.trim() || 'All recipes';
  const parts = [categoryLabel];
  const dietary = [];
  if (document.getElementById('filter-gluten')?.checked) dietary.push('GF');
  if (document.getElementById('filter-egg')?.checked) dietary.push('EF');
  if (document.getElementById('filter-dairy')?.checked) dietary.push('DF');
  if (dietary.length) parts.push(dietary.join(' • '));
  summary.textContent = parts.join(' • ');
}

function refreshUI() {
  renderCategoryPanel(recipeList, refreshUI);
  renderRecipes(recipeList);
  updateRefineSummary();
}

function initRefinePanel() {
  const panel = document.getElementById('refine-panel');
  if (!panel) return;

  const saved = localStorage.getItem('refineOpen');
  panel.open = saved === '1';
  panel.addEventListener('toggle', () => {
    localStorage.setItem('refineOpen', panel.open ? '1' : '0');
  });
}

async function main() {
  const built = await loadIndex();
  recipeList = built.map(recipeSummary);

  const update = () => refreshUI();
  renderCategoryPanel(recipeList, update);
  document.getElementById('filter-gluten').addEventListener('change', update);
  document.getElementById('filter-egg').addEventListener('change', update);
  document.getElementById('filter-dairy').addEventListener('change', update);
  document.getElementById('search-input').addEventListener('input', update);

  const hapticsToggle = document.getElementById('ruffle-haptics');
  if (hapticsToggle) {
    hapticsToggle.checked = isRuffleEnabled();
    hapticsToggle.addEventListener('change', () => setRuffleEnabled(hapticsToggle.checked));
  }

  initRefinePanel();
  refreshUI();
  setupMobileScrollRuffle();
  scheduleRecipeWarmup();
}

main().catch((error) => {
  const listEl = document.getElementById('recipe-list');
  listEl.textContent = error.message || 'Failed to load recipes';
});

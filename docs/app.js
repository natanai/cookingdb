import { familyListPending, getRememberedPassword, setRememberedPassword } from './inbox/inbox-api.js';
import { recipeDefaultCompatibility } from './recipe-utils.js';

const STORAGE_KEY = 'cookingdb-inbox-recipes';
const HAPTICS_KEY = 'cookingdb-ruffle-haptics';
let userInteracted = false;
let ruffleObserver = null;
let lastHapticAt = 0;
let mobileRuffleInstalled = false;
let mobileRuffleUpdate = null;

function installRecipePressFeedback(linkEl) {
  let startX = 0;
  let startY = 0;
  let canceled = false;

  linkEl.addEventListener('pointerdown', (e) => {
    if (linkEl.classList.contains('disabled-link')) return;

    if (e.pointerType === 'mouse' && e.button !== 0) return;

    canceled = false;
    startX = e.clientX;
    startY = e.clientY;
    linkEl.classList.add('is-pressed');

    try {
      linkEl.setPointerCapture?.(e.pointerId);
    } catch (_) {}
  });

  linkEl.addEventListener('pointermove', (e) => {
    if (!linkEl.classList.contains('is-pressed')) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.hypot(dx, dy) > 10) {
      canceled = true;
      linkEl.classList.remove('is-pressed');
    }
  });

  const clear = () => linkEl.classList.remove('is-pressed');
  linkEl.addEventListener('pointerup', clear);
  linkEl.addEventListener('pointercancel', () => {
    canceled = true;
    clear();
  });
  linkEl.addEventListener('lostpointercapture', clear);

  linkEl.addEventListener('click', (e) => {
    if (canceled) {
      e.preventDefault();
      e.stopPropagation();
    }
  });
}

function canUseRuffleHaptics() {
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches;
  const supportsVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  return !!(coarse && supportsVibrate && !reducedMotion);
}

function isRuffleEnabled() {
  const stored = localStorage.getItem(HAPTICS_KEY);
  if (stored === null) return true;
  return stored === 'true';
}

function setRuffleEnabled(value) {
  localStorage.setItem(HAPTICS_KEY, value ? 'true' : 'false');
}

function tinyHapticPulse() {
  if (!canUseRuffleHaptics()) return;
  if (!isRuffleEnabled()) return;
  if (!userInteracted) return;
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

  const rows = listEl.querySelectorAll('li.recipe-row');
  rows.forEach((row) => ruffleObserver.observe(row));
}

function setupMobileScrollRuffle() {
  const listEl = document.getElementById('recipe-list');
  if (!listEl) return;

  // Only for touch-style pointers and only if user hasn’t asked for reduced motion.
  const isCoarse = window.matchMedia?.('(pointer: coarse)')?.matches;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  if (!isCoarse || reduceMotion) return;

  let rows = Array.from(listEl.querySelectorAll('li.recipe-row'));
  if (!rows.length && mobileRuffleInstalled) {
    requestAnimationFrame(() => mobileRuffleUpdate?.());
    return;
  }

  // Choose an anchor line: slightly above center feels like “riffle” as you scroll.
  function anchorY() {
    return Math.round(window.innerHeight * 0.42);
  }

  let ticking = false;

  function update() {
    ticking = false;

    // Re-grab rows in case renderRecipes recreated them
    rows = Array.from(listEl.querySelectorAll('li.recipe-row'));
    if (!rows.length) return;

    const focusY = anchorY();
    const maxDist = Math.max(180, Math.round(window.innerHeight * 0.32)); // controls falloff

    // Track most-focused index so we can lightly nudge neighbors.
    let bestIdx = -1;
    let bestT = 0;

    // First pass: compute ruffle for visible rows only.
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const r = row.getBoundingClientRect();

      if (r.bottom < 0 || r.top > window.innerHeight) {
        row.style.setProperty('--ruffle', '0');
        row.style.setProperty('--ruffle-near', '0');
        continue;
      }

      const cy = r.top + r.height / 2;
      const dist = Math.abs(cy - focusY);
      const t = Math.max(0, 1 - (dist / maxDist)); // 0..1

      // Keep it extremely subtle by easing the curve a bit (squares small values)
      const eased = t * t;

      row.style.setProperty('--ruffle', eased.toFixed(3));
      row.style.setProperty('--ruffle-near', '0');

      if (eased > bestT) {
        bestT = eased;
        bestIdx = i;
      }
    }

    // Second pass: tiny cascade to neighbors (optional, very subtle)
    if (bestIdx >= 0) {
      const prev = rows[bestIdx - 1];
      const next = rows[bestIdx + 1];
      if (prev) prev.style.setProperty('--ruffle-near', (bestT * 0.55).toFixed(3));
      if (next) next.style.setProperty('--ruffle-near', (bestT * 0.55).toFixed(3));
    }
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }

  if (!mobileRuffleInstalled) {
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', () => requestAnimationFrame(update), { passive: true });
    mobileRuffleInstalled = true;
  }

  mobileRuffleUpdate = update;

  // Initial paint
  requestAnimationFrame(update);
}

async function loadIndex() {
  const res = await fetch('./built/index.json');
  if (!res.ok) throw new Error('Unable to load index.json');
  return res.json();
}

let selectedCategory = 'all';
let recipeList = [];
let inboxRecipes = loadStoredInboxRecipes();

function loadStoredInboxRecipes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch (err) {
    console.warn('Failed to parse stored inbox recipes', err);
    return [];
  }
}

function storeInboxRecipes(recipes) {
  inboxRecipes = recipes;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(recipes));
}

function normalizeTitleKey(title) {
  return (title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .split(/-+/)
    .filter(Boolean)
    .join('-');
}

function normalizeIngredients(raw, tokenOrder = []) {
  const list = Array.isArray(raw)
    ? raw.filter(Boolean)
    : raw && typeof raw === 'object'
      ? Object.values(raw).filter(Boolean)
      : [];

  const order = Array.isArray(tokenOrder) && tokenOrder.length
    ? tokenOrder
    : list.map((entry) => entry?.token).filter(Boolean);

  const byToken = {};
  list.forEach((entry) => {
    if (entry?.token) byToken[entry.token] = entry;
  });

  return { list, byToken, order };
}

function normalizeRecipePayload(entry) {
  // Support multiple API shapes:
  // - { payload: <recipe> }
  // - { payload: { title, payload: <recipe> } }  <-- envelope
  // - { recipe: <recipe> }
  const payload =
    entry?.recipe?.payload ??
    entry?.recipe ??
    entry?.payload?.payload ??
    entry?.payload ??
    entry;

  if (!payload) return null;

  const title = payload.title || entry?.title || '';
  const computedId =
    payload.id ||
    payload.recipe_id ||
    entry?.id ||
    entry?.recipe_id ||
    normalizeTitleKey(title);

  const ingredients = normalizeIngredients(payload.ingredients, payload.token_order);

  const compatibility =
    payload.compatibility_possible ||
    recipeDefaultCompatibility({ ...payload, ingredients: ingredients.byToken, token_order: ingredients.order });

  const hasDetails =
    ingredients.list.length > 0 &&
    ((typeof payload.steps_raw === 'string' && payload.steps_raw.trim().length > 0) ||
      (Array.isArray(payload.steps) && payload.steps.length > 0));

  return {
    ...payload,
    title,
    id: computedId,
    content_hash: payload.content_hash || entry?.content_hash,
    compatibility_possible: compatibility,
    ingredients: ingredients.byToken,
    token_order: ingredients.order,
    has_details: hasDetails,
  };
}



function recipeSummary(recipe, source = 'built') {
  return {
    id: recipe.id,
    title: recipe.title,
    categories: recipe.categories || [],
    compatibility_possible: recipe.compatibility_possible || { gluten_free: true, egg_free: true, dairy_free: true },
    content_hash: recipe.content_hash,
    _source: source,
    has_details: source === 'built' ? true : !!recipe.has_details,
  };
}

function recipeVisible(recipe, filters) {
  const matchesCategory =
    filters.category === 'all' || (recipe.categories || []).includes(filters.category);
  if (!matchesCategory) return false;

  if (filters.query) {
    const inTitle = (recipe.title || '').toLowerCase().includes(filters.query);
    const inCategories = (recipe.categories || []).some((cat) => cat.toLowerCase().includes(filters.query));
    if (!inTitle && !inCategories) return false;
  }
  const compatibility = recipe.compatibility_possible || {};
  if (filters.gluten && !compatibility.gluten_free) return false;
  if (filters.egg && !compatibility.egg_free) return false;
  if (filters.dairy && !compatibility.dairy_free) return false;
  return true;
}

const DIETARY_TAGS = {
  gluten_free: { positive: 'Gluten-free ready', negative: 'Contains gluten' },
  egg_free: { positive: 'Egg-free friendly', negative: 'Contains egg' },
  dairy_free: { positive: 'Dairy-free ready', negative: 'Contains dairy' },
};

function buildRecipeLink(recipeId) {
  const params = new URLSearchParams({ id: recipeId });
  return `recipe.html?${params.toString()}`;
}

function renderRecipes(recipes) {
  const listEl = document.getElementById('recipe-list');
  const filters = {
    gluten: document.getElementById('filter-gluten').checked,
    egg: document.getElementById('filter-egg').checked,
    dairy: document.getElementById('filter-dairy').checked,
    query: document.getElementById('search')?.value.trim().toLowerCase() || '',
    category: selectedCategory,
  };
  listEl.innerHTML = '';
  const visible = recipes.filter((r) => recipeVisible(r, filters));
  if (visible.length === 0) {
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
    if (recipe._source === 'inbox' && !recipe.has_details) {
      li.classList.add('recipe-card-incomplete');
    }

    const compatibility = recipe.compatibility_possible || {};
    const containsGluten = compatibility.gluten_free === false;
    const containsEgg = compatibility.egg_free === false;
    const containsDairy = compatibility.dairy_free === false;
    const flags = [];
    if (!containsGluten) flags.push({ label: 'GF', title: 'Gluten-free' });
    if (!containsEgg) flags.push({ label: 'EF', title: 'Egg-free' });
    if (!containsDairy) flags.push({ label: 'DF', title: 'Dairy-free' });

    const link = document.createElement('a');
    const hasDetails = recipe._source === 'built' ? true : !!recipe.has_details;
    link.className = 'recipe-row-link';
    if (hasDetails) {
      link.href = buildRecipeLink(recipe.id);
    } else {
      link.classList.add('disabled-link');
      link.title = 'Recipe details not yet available';
    }

    installRecipePressFeedback(link);

    const title = document.createElement('span');
    title.className = 'recipe-row-title';
    title.textContent = recipe.title;

    const flagContainer = document.createElement('span');
    flagContainer.className = 'recipe-row-flags';
    flagContainer.setAttribute('aria-label', 'Dietary-friendly indicators');
    flags.forEach((flag) => {
      const badge = document.createElement('span');
      badge.className = 'recipe-flag';
      badge.textContent = flag.label;
      badge.title = flag.title;
      badge.setAttribute('aria-label', flag.title);
      flagContainer.appendChild(badge);
    });

    link.appendChild(title);
    link.appendChild(flagContainer);
    li.appendChild(link);
    listEl.appendChild(li);
  });

  setupRuffleObserver(listEl);
  setupMobileScrollRuffle();
}

function uniqueCategories(recipes) {
  const set = new Set();
  recipes.forEach((recipe) => {
    (recipe.categories || []).forEach((cat) => set.add(cat));
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function renderCategoryPanel(recipes, onSelect) {
  const panel = document.getElementById('category-panel');
  const optionsContainer = document.getElementById('category-options');
  const currentLabel = document.getElementById('category-current');
  if (!panel || !optionsContainer || !currentLabel) return;

  const categories = ['all', ...uniqueCategories(recipes)];
  optionsContainer.innerHTML = '';
  currentLabel.textContent = selectedCategory === 'all' ? 'All recipes' : selectedCategory;

  categories.forEach((cat) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'category-option';
    btn.dataset.category = cat;
    btn.setAttribute('aria-pressed', selectedCategory === cat ? 'true' : 'false');
    btn.textContent = cat === 'all' ? 'All recipes' : cat;
    btn.addEventListener('click', () => {
      selectedCategory = cat;
      renderCategoryPanel(recipes, onSelect);
      onSelect();
      panel.open = false;
    });
    optionsContainer.appendChild(btn);
  });
}

function refreshUI() {
  renderCategoryPanel(recipeList, () => renderRecipes(recipeList));
  renderRecipes(recipeList);
}

function normalizeIncomingList(result) {
  if (!result) return [];
  const maybeList = Array.isArray(result)
  ? result
  : result.rows || result.pending || result.recipes || result.items;

  if (!maybeList || !Array.isArray(maybeList)) return [];
  return maybeList.map((entry) => normalizeRecipePayload(entry)).filter(Boolean);
}

function dedupeInboxRecipes(existing, incoming) {
  const mapById = new Map();
  existing.forEach((rec) => mapById.set(rec.id, rec));
  const hashMap = new Map();
  existing.forEach((rec) => {
    if (rec.content_hash) hashMap.set(rec.content_hash, rec);
  });
  const titleMap = new Map();
  existing.forEach((rec) => titleMap.set(normalizeTitleKey(rec.title), rec));

  const fresh = [];
  incoming.forEach((rec) => {
    if (mapById.has(rec.id)) return;
    if (rec.content_hash && hashMap.has(rec.content_hash)) return;
    if (titleMap.has(normalizeTitleKey(rec.title))) return;
    fresh.push(rec);
  });
  return fresh;
}

function addInboxRecipes(newOnes) {
  if (!newOnes.length) return 0;
  const next = [...inboxRecipes, ...newOnes];
  storeInboxRecipes(next);
  const summaries = next.map((rec) => recipeSummary(rec, 'inbox'));
  const builtSummaries = recipeList.filter((rec) => rec._source !== 'inbox');
  recipeList = [...builtSummaries, ...summaries];
  refreshUI();
  return newOnes.length;
}

function promptFamilyPassword() {
  const remembered = getRememberedPassword('family');
  const password = window.prompt('Family inbox password', remembered || '');
  if (password === null) return null;
  const rememberCheckbox = document.getElementById('remember-pull');
  if (rememberCheckbox?.checked) {
    setRememberedPassword({ kind: 'family', value: password, remember: true });
  } else if (password) {
    setRememberedPassword({ kind: 'family', value: password, remember: false });
  }
  return password;
}

function showPullStatus(message, kind = 'info') {
  const el = document.getElementById('pull-status');
  if (!el) return;
  el.textContent = message;
  el.className = `status ${kind}`;
}

async function handlePullClick() {
  try {
    const password = promptFamilyPassword();
    if (!password) return;
    showPullStatus('Pulling recipes from inbox...', 'info');
    const result = await familyListPending({
      familyPassword: password,
      // Always ask for payload so we can validate completeness.
      includePayload: true,
      include_payload: true,
    });
    const incoming = normalizeIncomingList(result);
    const completeRecipes = incoming.filter((rec) => rec?.has_details);
    const partialRecipes = incoming.filter((rec) => !rec?.has_details);

    const uniqueNew = dedupeInboxRecipes(inboxRecipes, completeRecipes);
    const addedCount = addInboxRecipes(uniqueNew);
    const messages = [];
    let statusKind = 'info';

    if (addedCount === 0) {
      messages.push('No new recipes to import right now.');
    } else {
      messages.push(`Added ${addedCount} recipe(s) from the inbox.`);
      statusKind = 'success';
    }

    if (partialRecipes.length > 0) {
      messages.push(`${partialRecipes.length} inbox recipe(s) skipped because details were missing.`);
      statusKind = 'warning';
    }

    showPullStatus(messages.join(' '), statusKind);
  } catch (err) {
    showPullStatus(err.message || 'Unable to pull recipes', 'error');
  }
}

async function main() {
  const built = await loadIndex();
  recipeList = [...built.map((rec) => recipeSummary(rec, 'built')), ...inboxRecipes.map((rec) => recipeSummary(rec, 'inbox'))];
  const update = () => renderRecipes(recipeList);
  renderCategoryPanel(recipeList, update);
  document.getElementById('filter-gluten').addEventListener('change', update);
  document.getElementById('filter-egg').addEventListener('change', update);
  document.getElementById('filter-dairy').addEventListener('change', update);
  document.getElementById('search').addEventListener('input', update);
  document.getElementById('pull-inbox')?.addEventListener('click', handlePullClick);

  window.addEventListener('pointerdown', () => { userInteracted = true; }, { once: true, passive: true });
  window.addEventListener('touchstart', () => { userInteracted = true; }, { once: true, passive: true });

  const hapticsToggle = document.getElementById('ruffle-haptics');
  if (hapticsToggle) {
    hapticsToggle.checked = isRuffleEnabled();
    hapticsToggle.addEventListener('change', () => {
      setRuffleEnabled(hapticsToggle.checked);
    });
  }
  refreshUI();
  setupMobileScrollRuffle();
}

main().catch((err) => {
  const listEl = document.getElementById('recipe-list');
  listEl.textContent = err.message || 'Failed to load recipes';
});

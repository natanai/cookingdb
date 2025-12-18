import { familyListPending, getRememberedPassword, setRememberedPassword } from './inbox/inbox-api.js';
import { recipeDefaultCompatibility } from './recipe-utils.js';

const STORAGE_KEY = 'cookingdb-inbox-recipes';

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

function createTag(labels, value) {
  const pill = document.createElement('span');
  pill.className = value ? 'pill' : 'pill neutral';
  pill.textContent = value ? labels.positive : labels.negative;
  return pill;
}

function buildRecipeLink(recipeId) {
  const params = new URLSearchParams({ id: recipeId });
  return `recipe.html?${params.toString()}`;
}

function describeFilters(filters) {
  const active = [];
  if (filters.queryLabel) active.push(`Search: “${filters.queryLabel}”`);
  if (filters.category !== 'all') active.push(`Category: ${filters.category}`);
  if (filters.gluten) active.push('Gluten-free only');
  if (filters.egg) active.push('Egg-free only');
  if (filters.dairy) active.push('Dairy-free only');
  return active;
}

function renderResultsSummary(visible, filters, totalCount) {
  const summaryEl = document.getElementById('result-summary');
  const activeEl = document.getElementById('active-filters');
  const clearBtn = document.getElementById('clear-filters');
  if (!summaryEl || !activeEl || !clearBtn) return;

  const activeFilters = describeFilters(filters);
  const hasFilters = activeFilters.length > 0;
  summaryEl.textContent = `${visible.length} of ${totalCount} recipe${totalCount === 1 ? '' : 's'} shown`;
  if (filters.queryLabel && visible.length === 0) {
    summaryEl.textContent += ` for “${filters.queryLabel}”.`;
  }

  activeEl.innerHTML = '';
  if (hasFilters) {
    activeFilters.forEach((label) => {
      const chip = document.createElement('span');
      chip.className = 'filter-chip';
      chip.textContent = label;
      activeEl.appendChild(chip);
    });
  } else {
    const none = document.createElement('span');
    none.className = 'muted';
    none.textContent = 'No filters active';
    activeEl.appendChild(none);
  }

  clearBtn.disabled = !hasFilters;
}

function renderRecipes(recipes) {
  const listEl = document.getElementById('recipe-list');
  const rawQuery = document.getElementById('search')?.value || '';
  const filters = {
    gluten: document.getElementById('filter-gluten').checked,
    egg: document.getElementById('filter-egg').checked,
    dairy: document.getElementById('filter-dairy').checked,
    query: rawQuery.trim().toLowerCase() || '',
    queryLabel: rawQuery.trim(),
    category: selectedCategory,
  };
  listEl.innerHTML = '';
  const visible = recipes.filter((r) => recipeVisible(r, filters));
  renderResultsSummary(visible, filters, recipes.length);
  if (visible.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = 'No recipes match that search just yet—try clearing a filter.';
    listEl.appendChild(empty);
    return;
  }
  visible.forEach((recipe) => {
    const li = document.createElement('li');
    li.className = 'recipe-card';
    if (recipe._source === 'inbox' && !recipe.has_details) {
      li.classList.add('recipe-card-incomplete');
    }

    const link = document.createElement('a');
    const hasDetails = recipe._source === 'built' ? true : !!recipe.has_details;
    link.textContent = recipe.title;
    if (hasDetails) {
      link.href = buildRecipeLink(recipe.id);
    } else {
      link.classList.add('disabled-link');
      link.title = 'Recipe details not yet available';
    }
    li.appendChild(link);
    const tags = document.createElement('div');
    tags.className = 'tags';
    const compatibility = recipe.compatibility_possible || {};
    tags.appendChild(createTag(DIETARY_TAGS.gluten_free, compatibility.gluten_free));
    tags.appendChild(createTag(DIETARY_TAGS.egg_free, compatibility.egg_free));
    tags.appendChild(createTag(DIETARY_TAGS.dairy_free, compatibility.dairy_free));
    if (recipe._source === 'inbox') {
      const badge = document.createElement('span');
      badge.className = 'pill inbox-pill';
      badge.textContent = 'Inbox';
      tags.appendChild(badge);
      if (!recipe.has_details) {
        const missing = document.createElement('span');
        missing.className = 'pill neutral';
        missing.textContent = 'Details pending';
        tags.appendChild(missing);
      }
    }
    li.appendChild(tags);
    if (recipe._source === 'inbox' && !recipe.has_details) {
      const warning = document.createElement('div');
      warning.className = 'recipe-warning';
      warning.textContent = 'Waiting for full recipe details before this can be viewed.';
      li.appendChild(warning);
    }
    listEl.appendChild(li);
  });
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

function clearFilters() {
  const search = document.getElementById('search');
  const gluten = document.getElementById('filter-gluten');
  const egg = document.getElementById('filter-egg');
  const dairy = document.getElementById('filter-dairy');
  if (search) search.value = '';
  if (gluten) gluten.checked = false;
  if (egg) egg.checked = false;
  if (dairy) dairy.checked = false;
  selectedCategory = 'all';
  refreshUI();
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
  document.getElementById('clear-filters')?.addEventListener('click', clearFilters);
  refreshUI();
}

main().catch((err) => {
  const listEl = document.getElementById('recipe-list');
  listEl.textContent = err.message || 'Failed to load recipes';
});

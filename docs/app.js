const TOGGLES = [
  { key: 'gluten_free', label: 'Gluten-free' },
  { key: 'egg_free', label: 'Egg-free' },
  { key: 'dairy_free', label: 'Dairy-free' }
];

const STORAGE_KEYS = {
  filters: 'cookingdb.filters',
  categories: 'cookingdb.categories'
};

const DEFAULT_FILTERS = { gluten_free: false, egg_free: false, dairy_free: false };

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEYS.filters) || localStorage.getItem('cookingdb-filters');
  if (!raw) return { ...DEFAULT_FILTERS };
  try {
    const parsed = JSON.parse(raw);
    return {
      gluten_free: !!parsed.gluten_free,
      egg_free: !!parsed.egg_free,
      dairy_free: !!parsed.dairy_free
    };
  } catch {
    return { ...DEFAULT_FILTERS };
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEYS.filters, JSON.stringify(state));
}

function loadCategories() {
  const raw = localStorage.getItem(STORAGE_KEYS.categories);
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((item) => typeof item === 'string' && item.trim().length > 0));
  } catch {
    return new Set();
  }
}

function saveCategories(categories) {
  localStorage.setItem(STORAGE_KEYS.categories, JSON.stringify(Array.from(categories)));
}

function renderToggles(state, onChange) {
  const container = document.getElementById('toggles');
  container.innerHTML = '';

  TOGGLES.forEach((toggle) => {
    const label = document.createElement('label');
    label.className = 'toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = state[toggle.key];
    input.addEventListener('change', () => {
      state[toggle.key] = input.checked;
      saveState(state);
      onChange();
    });
    const span = document.createElement('span');
    span.textContent = toggle.label;
    label.append(input, span);
    container.append(label);
  });
}

function recipePassesFilters(recipe, filters) {
  if (filters.gluten_free && !recipe.compatibility_possible.gluten_free) return false;
  if (filters.egg_free && !recipe.compatibility_possible.egg_free) return false;
  if (filters.dairy_free && !recipe.compatibility_possible.dairy_free) return false;
  return true;
}

function recipePassesCategories(recipe, selectedCategories) {
  if (selectedCategories.size === 0 || selectedCategories.has('All')) return true;
  return recipe.categories.some((cat) => selectedCategories.has(cat));
}

function createCategoryChips(categories, onClick) {
  const wrapper = document.createElement('div');
  wrapper.className = 'chips category-tags';
  categories.forEach((cat) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = cat;
    if (onClick) {
      chip.addEventListener('click', () => onClick(cat));
    }
    wrapper.appendChild(chip);
  });
  return wrapper;
}

function renderRecipes(recipes, filters, selectedCategories, onCategorySelect) {
  const container = document.getElementById('recipes');
  container.innerHTML = '';

  const filtered = recipes.filter(
    (recipe) => recipePassesFilters(recipe, filters) && recipePassesCategories(recipe, selectedCategories)
  );
  if (filtered.length === 0) {
    container.textContent = 'No recipes match these chapters and filters yet. Try clearing a selection?';
    return;
  }

  filtered.forEach((recipe) => {
    const card = document.createElement('article');
    card.className = 'card';

    const title = document.createElement('h3');
    title.textContent = recipe.title;

    const link = document.createElement('a');
    link.href = `./recipe.html?id=${encodeURIComponent(recipe.id)}`;
    link.className = 'button-link';
    link.textContent = 'Open recipe';

    card.append(title);
    card.append(createCategoryChips(recipe.categories || [], onCategorySelect));
    card.append(link);

    container.append(card);
  });
}

function readUrlState() {
  const params = new URLSearchParams(window.location.search);
  const categories = params.getAll('cat').map((c) => c.trim()).filter(Boolean);
  const gf = params.get('gf');
  const ef = params.get('ef');
  const df = params.get('df');

  if (categories.length === 0 && gf === null && ef === null && df === null) return null;

  return {
    categories,
    filters: {
      gluten_free: gf === '1' || gf === 'true',
      egg_free: ef === '1' || ef === 'true',
      dairy_free: df === '1' || df === 'true'
    }
  };
}

function updateUrl(filters, selectedCategories) {
  const params = new URLSearchParams();
  Array.from(selectedCategories)
    .filter((cat) => cat !== 'All')
    .forEach((cat) => params.append('cat', cat));
  if (filters.gluten_free) params.set('gf', '1');
  if (filters.egg_free) params.set('ef', '1');
  if (filters.dairy_free) params.set('df', '1');

  const query = params.toString();
  const target = query ? `${window.location.pathname}?${query}` : window.location.pathname;
  window.history.replaceState({}, '', target);
}

function renderChapters(allCategories, counts, selectedCategories, onChange, totalRecipes) {
  const container = document.getElementById('chapters');
  const clearButton = document.getElementById('clear-chapters');
  container.innerHTML = '';

  const isAllSelected = selectedCategories.size === 0 || selectedCategories.has('All');

  const renderTab = (label, count) => {
    const tab = document.createElement('button');
    tab.className = 'chapter-tab';
    tab.type = 'button';
    tab.textContent = label;
    if ((isAllSelected && label === 'All') || selectedCategories.has(label)) {
      tab.classList.add('selected');
    }

    const countSpan = document.createElement('span');
    countSpan.className = 'count';
    countSpan.textContent = `${count ?? 0} recipe${(count ?? 0) === 1 ? '' : 's'}`;
    tab.appendChild(countSpan);

    tab.addEventListener('click', () => {
      if (label === 'All') {
        selectedCategories.clear();
      } else {
        if (selectedCategories.has(label)) {
          selectedCategories.delete(label);
        } else {
          selectedCategories.delete('All');
          selectedCategories.add(label);
        }
      }
      if (selectedCategories.size === 0) {
        selectedCategories.delete('All');
      }
      onChange();
    });

    container.appendChild(tab);
  };

  renderTab('All', totalRecipes);
  allCategories.forEach((cat) => {
    renderTab(cat, counts?.[cat]);
  });

  clearButton.style.display = selectedCategories.size > 0 ? 'inline' : 'none';
  clearButton.onclick = () => {
    selectedCategories.clear();
    onChange();
  };
}

async function init() {
  const res = await fetch('./built/index.json');
  const index = await res.json();

  let filters = loadState();
  let selectedCategories = loadCategories();
  const urlState = readUrlState();
  if (urlState) {
    filters = urlState.filters;
    selectedCategories = new Set(urlState.categories);
  }

  const persistAndRender = () => {
    saveState(filters);
    saveCategories(selectedCategories);
    updateUrl(filters, selectedCategories);
    renderChapters(index.all_categories, index.category_counts, selectedCategories, persistAndRender, index.recipes.length);
    renderRecipes(index.recipes, filters, selectedCategories, (cat) => {
      selectedCategories.delete('All');
      selectedCategories.add(cat);
      persistAndRender();
    });
  };

  renderToggles(filters, () => {
    persistAndRender();
  });

  persistAndRender();
}

init();

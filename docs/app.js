const TOGGLES = [
  { key: 'gluten_free', label: 'Gluten-free' },
  { key: 'egg_free', label: 'Egg-free' },
  { key: 'dairy_free', label: 'Dairy-free' }
];

function loadState() {
  const raw = localStorage.getItem('cookingdb-filters');
  if (!raw) return { gluten_free: false, egg_free: false, dairy_free: false };
  try {
    const parsed = JSON.parse(raw);
    return { gluten_free: !!parsed.gluten_free, egg_free: !!parsed.egg_free, dairy_free: !!parsed.dairy_free };
  } catch {
    return { gluten_free: false, egg_free: false, dairy_free: false };
  }
}

function saveState(state) {
  localStorage.setItem('cookingdb-filters', JSON.stringify(state));
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

function createCategoryChips(categories) {
  const wrapper = document.createElement('div');
  wrapper.className = 'chips';
  categories.forEach((cat) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = cat;
    wrapper.appendChild(chip);
  });
  return wrapper;
}

function renderRecipes(recipes, filters) {
  const container = document.getElementById('recipes');
  container.innerHTML = '';

  const filtered = recipes.filter((recipe) => recipePassesFilters(recipe, filters));
  if (filtered.length === 0) {
    container.textContent = 'No recipes match the selected dietary filters yet.';
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
    card.append(createCategoryChips(recipe.categories || []));
    card.append(link);

    container.append(card);
  });
}

async function init() {
  const res = await fetch('./built/index.json');
  const index = await res.json();
  const filters = loadState();
  renderToggles(filters, () => renderRecipes(index.recipes, filters));
  renderRecipes(index.recipes, filters);
}

init();

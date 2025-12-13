async function loadIndex() {
  const res = await fetch('./built/index.json');
  if (!res.ok) throw new Error('Unable to load index.json');
  return res.json();
}

let selectedCategory = 'all';

function recipeVisible(recipe, filters) {
  const matchesCategory =
    filters.category === 'all' || (recipe.categories || []).includes(filters.category);
  if (!matchesCategory) return false;

  if (filters.query) {
    const inTitle = recipe.title.toLowerCase().includes(filters.query);
    const inCategories = (recipe.categories || []).some((cat) => cat.toLowerCase().includes(filters.query));
    if (!inTitle && !inCategories) return false;
  }
  if (filters.gluten && !recipe.compatibility_possible.gluten_free) return false;
  if (filters.egg && !recipe.compatibility_possible.egg_free) return false;
  if (filters.dairy && !recipe.compatibility_possible.dairy_free) return false;
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

function buildRecipeLink(recipeId, filters) {
  const params = new URLSearchParams({ id: recipeId });
  if (filters.gluten) params.set('gluten_free', '1');
  if (filters.egg) params.set('egg_free', '1');
  if (filters.dairy) params.set('dairy_free', '1');
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
    return;
  }
  visible.forEach((recipe) => {
    const li = document.createElement('li');
    li.className = 'recipe-card';

    const link = document.createElement('a');
    link.href = buildRecipeLink(recipe.id, filters);
    link.textContent = recipe.title;
    li.appendChild(link);
    const tags = document.createElement('div');
    tags.className = 'tags';
    tags.appendChild(createTag(DIETARY_TAGS.gluten_free, recipe.compatibility_possible.gluten_free));
    tags.appendChild(createTag(DIETARY_TAGS.egg_free, recipe.compatibility_possible.egg_free));
    tags.appendChild(createTag(DIETARY_TAGS.dairy_free, recipe.compatibility_possible.dairy_free));
    li.appendChild(tags);
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

async function main() {
  const data = await loadIndex();
  const update = () => renderRecipes(data);
  renderCategoryPanel(data, update);
  document.getElementById('filter-gluten').addEventListener('change', update);
  document.getElementById('filter-egg').addEventListener('change', update);
  document.getElementById('filter-dairy').addEventListener('change', update);
  document.getElementById('search').addEventListener('input', update);
  update();
}

main().catch((err) => {
  const listEl = document.getElementById('recipe-list');
  listEl.textContent = err.message || 'Failed to load recipes';
});

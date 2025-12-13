async function loadIndex() {
  const res = await fetch('./built/index.json');
  if (!res.ok) throw new Error('Unable to load index.json');
  return res.json();
}

function recipeVisible(recipe, filters) {
  if (filters.query && !recipe.title.toLowerCase().includes(filters.query)) return false;
  if (filters.gluten && !recipe.compatibility_possible.gluten_free) return false;
  if (filters.egg && !recipe.compatibility_possible.egg_free) return false;
  if (filters.dairy && !recipe.compatibility_possible.dairy_free) return false;
  return true;
}

function createTag(label, value) {
  const pill = document.createElement('span');
  pill.className = value ? 'pill' : 'pill neutral';
  pill.textContent = value ? label : `Contains ${label.toLowerCase()}`;
  return pill;
}

function renderRecipes(recipes) {
  const listEl = document.getElementById('recipe-list');
  const filters = {
    gluten: document.getElementById('filter-gluten').checked,
    egg: document.getElementById('filter-egg').checked,
    dairy: document.getElementById('filter-dairy').checked,
    query: document.getElementById('search')?.value.trim().toLowerCase() || '',
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
    link.href = `recipe.html?id=${encodeURIComponent(recipe.id)}`;
    link.textContent = recipe.title;
    li.appendChild(link);
    const tags = document.createElement('div');
    tags.className = 'tags';
    tags.appendChild(createTag('Gluten-free ready', recipe.compatibility_possible.gluten_free));
    tags.appendChild(createTag('Egg-free friendly', recipe.compatibility_possible.egg_free));
    tags.appendChild(createTag('Dairy-free ready', recipe.compatibility_possible.dairy_free));
    li.appendChild(tags);
    listEl.appendChild(li);
  });
}

async function main() {
  const data = await loadIndex();
  const update = () => renderRecipes(data);
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

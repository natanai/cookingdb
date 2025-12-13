async function loadIndex() {
  const res = await fetch('./built/index.json');
  if (!res.ok) throw new Error('Unable to load index.json');
  return res.json();
}

function recipeVisible(recipe, filters) {
  if (filters.gluten && !recipe.compatibility_possible.gluten_free) return false;
  if (filters.egg && !recipe.compatibility_possible.egg_free) return false;
  if (filters.dairy && !recipe.compatibility_possible.dairy_free) return false;
  return true;
}

function renderRecipes(recipes) {
  const listEl = document.getElementById('recipe-list');
  const filters = {
    gluten: document.getElementById('filter-gluten').checked,
    egg: document.getElementById('filter-egg').checked,
    dairy: document.getElementById('filter-dairy').checked,
  };
  listEl.innerHTML = '';
  recipes.filter((r) => recipeVisible(r, filters)).forEach((recipe) => {
    const li = document.createElement('li');
    li.className = 'recipe-card';
    const link = document.createElement('a');
    link.href = `recipe.html?id=${encodeURIComponent(recipe.id)}`;
    link.textContent = recipe.title;
    li.appendChild(link);
    const tags = document.createElement('div');
    tags.className = 'tags';
    tags.textContent = `GF: ${recipe.compatibility_possible.gluten_free ? 'yes' : 'no'} | Egg-free: ${
      recipe.compatibility_possible.egg_free ? 'yes' : 'no'
    } | Dairy-free: ${recipe.compatibility_possible.dairy_free ? 'yes' : 'no'}`;
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
  update();
}

main().catch((err) => {
  const listEl = document.getElementById('recipe-list');
  listEl.textContent = err.message || 'Failed to load recipes';
});

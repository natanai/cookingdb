const BREAD_CATEGORY = 'Bread maker';
const PERSONAL_STORAGE_KEY = 'cookingdb-bread-maker-recipes';

const defaultListEl = document.getElementById('bread-default-list');
const personalListEl = document.getElementById('bread-personal-list');
const personalFormEl = document.getElementById('personal-recipe-form');

function splitRecipeTitle(rawTitle) {
  const title = (rawTitle || '').trim();
  if (!title) return { title: '', name: '' };

  const parenMatch = title.match(/^(.*)\s*\(([^)]+)\)\s*$/);
  if (parenMatch) {
    return { title: parenMatch[1].trim(), name: parenMatch[2].trim() };
  }

  const possessiveMatch = title.match(/^([^–—-]+?)\s*['’]s\s+(.+)$/i);
  if (possessiveMatch) {
    return { title: possessiveMatch[2].trim(), name: possessiveMatch[1].trim() };
  }

  return { title, name: '' };
}

function getRecipeTitleParts(recipe) {
  const byline = (recipe?.byline || '').trim();
  if (byline) {
    return { title: (recipe?.title || '').trim(), name: byline };
  }
  return splitRecipeTitle(recipe?.title || '');
}

function buildRecipeLink(recipeId) {
  const params = new URLSearchParams({ id: recipeId });
  return `recipe.html?${params.toString()}`;
}

function renderDefaultRecipes(recipes) {
  if (!defaultListEl) return;
  defaultListEl.innerHTML = '';

  if (!recipes.length) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = 'No bread maker recipes are available yet.';
    defaultListEl.appendChild(empty);
    return;
  }

  recipes.forEach((recipe) => {
    const li = document.createElement('li');
    li.className = 'recipe-row';

    const link = document.createElement('a');
    link.className = 'recipe-row-link';
    link.href = buildRecipeLink(recipe.id);

    const title = document.createElement('span');
    title.className = 'recipe-row-title';

    const titleText = document.createElement('span');
    titleText.className = 'recipe-row-title-text';
    const { title: cleanTitle, name: titleName } = getRecipeTitleParts(recipe);
    titleText.textContent = cleanTitle;
    title.appendChild(titleText);

    if (titleName) {
      const nameEl = document.createElement('span');
      nameEl.className = 'recipe-row-title-name';
      nameEl.textContent = ` — ${titleName}`;
      title.appendChild(nameEl);
    }

    const compatibility = recipe.compatibility_possible || {};
    const containsGluten = compatibility.gluten_free === false;
    const containsEgg = compatibility.egg_free === false;
    const containsDairy = compatibility.dairy_free === false;
    const flags = [];
    if (!containsGluten) flags.push({ label: 'GF', title: 'Gluten-free' });
    if (!containsEgg) flags.push({ label: 'EF', title: 'Egg-free' });
    if (!containsDairy) flags.push({ label: 'DF', title: 'Dairy-free' });

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
    defaultListEl.appendChild(li);
  });
}

function normalizeLines(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function loadPersonalRecipes() {
  try {
    const raw = localStorage.getItem(PERSONAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch (err) {
    console.warn('Unable to load bread maker recipes', err);
    return [];
  }
}

function savePersonalRecipes(recipes) {
  localStorage.setItem(PERSONAL_STORAGE_KEY, JSON.stringify(recipes));
}

function renderPersonalRecipes(recipes, onUpdate) {
  if (!personalListEl) return;
  personalListEl.innerHTML = '';

  if (!recipes.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No personal bread recipes yet. Add your first batch notes to start your journal.';
    personalListEl.appendChild(empty);
    return;
  }

  recipes.forEach((recipe) => {
    const card = document.createElement('article');
    card.className = 'personal-recipe-card';

    const header = document.createElement('div');
    header.className = 'personal-recipe-header';

    const titleBlock = document.createElement('div');

    const title = document.createElement('h3');
    title.className = 'personal-recipe-title';
    title.textContent = recipe.title;

    const meta = document.createElement('p');
    meta.className = 'personal-recipe-meta';
    meta.textContent = recipe.loaf || 'Personal recipe';

    titleBlock.appendChild(title);
    titleBlock.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'personal-recipe-actions';

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'button secondary button-compact';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => {
      const next = recipes.filter((entry) => entry.id !== recipe.id);
      onUpdate?.(next);
    });

    actions.appendChild(deleteBtn);
    header.appendChild(titleBlock);
    header.appendChild(actions);
    card.appendChild(header);

    const ingredientLines = normalizeLines(recipe.ingredients);
    if (ingredientLines.length) {
      const ingredientWrap = document.createElement('div');
      ingredientWrap.className = 'personal-recipe-section';

      const ingredientTitle = document.createElement('p');
      ingredientTitle.className = 'personal-recipe-label';
      ingredientTitle.textContent = 'Ingredients';

      const ingredientList = document.createElement('ul');
      ingredientList.className = 'personal-recipe-list';
      ingredientLines.forEach((line) => {
        const item = document.createElement('li');
        item.textContent = line;
        ingredientList.appendChild(item);
      });

      ingredientWrap.appendChild(ingredientTitle);
      ingredientWrap.appendChild(ingredientList);
      card.appendChild(ingredientWrap);
    }

    const stepLines = normalizeLines(recipe.steps);
    if (stepLines.length) {
      const stepWrap = document.createElement('div');
      stepWrap.className = 'personal-recipe-section';

      const stepTitle = document.createElement('p');
      stepTitle.className = 'personal-recipe-label';
      stepTitle.textContent = 'Steps';

      const stepList = document.createElement('ol');
      stepList.className = 'personal-recipe-list';
      stepLines.forEach((line) => {
        const item = document.createElement('li');
        item.textContent = line;
        stepList.appendChild(item);
      });

      stepWrap.appendChild(stepTitle);
      stepWrap.appendChild(stepList);
      card.appendChild(stepWrap);
    }

    const notesWrap = document.createElement('div');
    notesWrap.className = 'personal-recipe-section personal-recipe-notes';

    const notesLabel = document.createElement('label');
    notesLabel.className = 'personal-recipe-label';
    notesLabel.textContent = 'Notes (editable anytime)';

    const notesArea = document.createElement('textarea');
    notesArea.rows = 3;
    notesArea.value = recipe.notes || '';
    notesArea.addEventListener('input', (event) => {
      recipe.notes = event.target.value;
      savePersonalRecipes(recipes);
    });

    notesWrap.appendChild(notesLabel);
    notesWrap.appendChild(notesArea);
    card.appendChild(notesWrap);

    personalListEl.appendChild(card);
  });
}

async function loadDefaultRecipes() {
  const res = await fetch('./built/index.json');
  if (!res.ok) {
    throw new Error('Unable to load index.json');
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function initDefaultRecipes() {
  try {
    const recipes = await loadDefaultRecipes();
    const filtered = recipes
      .filter((recipe) => (recipe.categories || []).includes(BREAD_CATEGORY))
      .sort((a, b) => {
        const aTitle = getRecipeTitleParts(a).title;
        const bTitle = getRecipeTitleParts(b).title;
        return aTitle.localeCompare(bTitle, undefined, { sensitivity: 'base' });
      });
    renderDefaultRecipes(filtered);
  } catch (err) {
    console.warn('Unable to load bread maker recipes', err);
  }
}

function initPersonalRecipes() {
  let recipes = loadPersonalRecipes();
  const updateRecipes = (next) => {
    recipes = Array.isArray(next) ? next : recipes;
    savePersonalRecipes(recipes);
    renderPersonalRecipes(recipes, updateRecipes);
  };

  renderPersonalRecipes(recipes, updateRecipes);

  if (personalFormEl) {
    personalFormEl.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(personalFormEl);
      const title = String(formData.get('title') || '').trim();
      const loaf = String(formData.get('loaf') || '').trim();
      const ingredients = String(formData.get('ingredients') || '').trim();
      const steps = String(formData.get('steps') || '').trim();
      const notes = String(formData.get('notes') || '').trim();

      if (!title || !ingredients || !steps) return;

      const recipe = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        title,
        loaf,
        ingredients,
        steps,
        notes,
      };

      const next = [recipe, ...recipes];
      updateRecipes(next);
      personalFormEl.reset();
    });
  }
}

initDefaultRecipes();
initPersonalRecipes();

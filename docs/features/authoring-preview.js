import { renderIngredientLines, renderStepLines, groupLinesBySection, recipeDefaultCompatibility } from '../recipe-utils.js';

export function renderPreview(recipe) {
  const titleEl = document.getElementById('preview-recipe-title');
  const noteDetails = document.getElementById('preview-recipe-note');
  const notesEl = document.getElementById('preview-notes');
  const dietaryBadgesEl = document.getElementById('preview-dietary-badges');
  const familyBadgeEl = document.getElementById('preview-family-badge');
  const categoryBadgeEl = document.getElementById('preview-category-badge');
  const batchMultiplierEl = document.getElementById('preview-batch-multiplier');
  const ingredientsEl = document.getElementById('preview-ingredients');
  const stepsEl = document.getElementById('preview-steps');

  const defaultCompatibility = recipeDefaultCompatibility(recipe);
  const compatibilityPossible = recipe.compatibility_possible || {};
  const hasChoiceTokens = Object.values(recipe.ingredients || {}).some((entry) => entry?.isChoice);

  if (titleEl) titleEl.textContent = recipe.title || 'Recipe title';

  const noteText = (recipe.notes || '').trim();
  if (noteDetails) {
    if (noteText) {
      noteDetails.hidden = false;
      noteDetails.open = false;
      if (notesEl) notesEl.textContent = noteText;
    } else {
      noteDetails.hidden = true;
      if (notesEl) notesEl.textContent = '';
    }
  }

  if (categoryBadgeEl) {
    const primaryCategory = (recipe.categories || [])[0] || 'Uncategorized';
    categoryBadgeEl.textContent = primaryCategory;
  }

  if (familyBadgeEl) {
    const familyName = (recipe.family || '').trim();
    if (familyName) {
      familyBadgeEl.textContent = `Family: ${familyName}`;
      familyBadgeEl.style.display = '';
    } else {
      familyBadgeEl.style.display = 'none';
    }
  }

  if (batchMultiplierEl) {
    const multiplier = Number(recipe.default_base) || 1;
    batchMultiplierEl.value = multiplier;
  }

  renderPreviewDietaryBadges(dietaryBadgesEl, defaultCompatibility, compatibilityPossible, hasChoiceTokens);

  const state = {
    multiplier: recipe.default_base || 1,
    panMultiplier: 1,
    selectedOptions: {},
    restrictions: {
      gluten_free: compatibilityPossible.gluten_free ? defaultCompatibility.gluten_free : false,
      egg_free: compatibilityPossible.egg_free ? defaultCompatibility.egg_free : false,
      dairy_free: compatibilityPossible.dairy_free ? defaultCompatibility.dairy_free : false,
    },
  };

  const ingredientLines = renderIngredientLines(recipe, state);
  const ingredientSections = groupLinesBySection(ingredientLines, recipe.ingredient_sections || []);
  renderPreviewLines(ingredientsEl, ingredientSections, { showAlternatives: true });

  const steps = renderStepLines(recipe, state);
  const stepSections = groupLinesBySection(steps, recipe.step_sections || []);
  renderPreviewLines(stepsEl, stepSections, { allowHtml: true });
}

function renderPreviewDietaryBadges(container, defaultCompatibility, compatibilityPossible, hasChoiceTokens) {
  if (!container) return;

  const BADGES = [
    { key: 'gluten_free', short: 'GF', name: 'Gluten-free' },
    { key: 'egg_free', short: 'EF', name: 'Egg-free' },
    { key: 'dairy_free', short: 'DF', name: 'Dairy-free' },
  ];

  container.innerHTML = '';

  BADGES.forEach(({ key, short, name }) => {
    const ready = !!defaultCompatibility[key];
    const possible = !!compatibilityPossible[key] || hasChoiceTokens;
    const status = !possible && !ready ? 'cannot' : ready ? 'ready' : 'can-become';

    const badge = document.createElement('span');
    badge.className = `diet-badge diet-badge--${status} is-static`;
    badge.title = `${name}: ${ready ? 'meets by default' : possible ? 'can be made' : 'no swaps yet'}`;

    const text = document.createElement('span');
    text.className = 'diet-badge__text';
    text.textContent = short;

    const icon = document.createElement('span');
    icon.className = 'diet-badge__icon';
    icon.setAttribute('aria-hidden', 'true');

    badge.append(text, icon);
    container.appendChild(badge);
  });
}

function renderPreviewLines(container, sections, options = {}) {
  if (!container) return;
  const { showAlternatives = false, allowHtml = false } = options;

  container.innerHTML = '';

  if (!sections.length) {
    const placeholder = document.createElement('li');
    placeholder.className = 'section-header';
    placeholder.textContent = 'Details will appear here.';
    container.appendChild(placeholder);
    return;
  }

  sections.forEach((section) => {
    if (section.section) {
      const header = document.createElement('li');
      header.className = 'section-header';
      header.textContent = section.section;
      container.appendChild(header);
    }

    section.lines.forEach((line) => {
      const li = document.createElement('li');
      if (allowHtml) {
        li.innerHTML = `<span class="step-text">${line.text}</span>`;
      } else {
        li.textContent = line.text;
      }
      if (showAlternatives && line.alternatives.length) {
        const span = document.createElement('span');
        span.className = 'ingredient-alternatives';
        span.textContent = ` (or ${line.alternatives.join(' / ')})`;
        li.appendChild(span);
      }
      container.appendChild(li);
    });
  });
}


async function loadRecipes() {
  const res = await fetch('./built/recipes.json');
  if (!res.ok) throw new Error('Unable to load recipes');
  return res.json();
}

function getRecipeIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get('id');
}

function parseRatio(str) {
  if (!str) return null;
  const trimmed = str.trim();
  if (!trimmed) return null;
  let whole = 0;
  let fracPart = trimmed;
  if (trimmed.includes(' ')) {
    const parts = trimmed.split(' ');
    whole = Number(parts[0]);
    fracPart = parts[1];
  }
  let num;
  let den;
  if (fracPart.includes('/')) {
    const [n, d] = fracPart.split('/');
    num = Number(n);
    den = Number(d);
  } else {
    num = Number(fracPart);
    den = 1;
  }
  const totalNum = whole * den + num;
  return simplify({ num: totalNum, den });
}

function simplify(frac) {
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(Math.abs(frac.num), Math.abs(frac.den));
  return { num: frac.num / g, den: frac.den / g };
}

function decimalToFraction(value, maxDen = 16) {
  const den = maxDen;
  const num = Math.round(value * den);
  return simplify({ num, den });
}

function multiplyFraction(frac, multiplier) {
  if (!frac) return null;
  const multFrac = decimalToFraction(multiplier);
  return simplify({ num: frac.num * multFrac.num, den: frac.den * multFrac.den });
}

function formatFraction(frac) {
  if (!frac) return '';
  const whole = Math.trunc(frac.num / frac.den);
  const remainder = Math.abs(frac.num % frac.den);
  if (remainder === 0) return `${whole}`;
  if (whole === 0) return `${frac.num}/${frac.den}`;
  return `${whole} ${remainder}/${frac.den}`;
}

function pluralize(display, amount, unit) {
  if (unit === 'count') {
    if (Math.abs(amount - 1) < 1e-9) return display;
    if (display.endsWith('s')) return display;
    return `${display}s`;
  }
  return display;
}

function renderIngredientEntry(option, multiplier) {
  if (!option.ratio) return option.display;
  const baseFraction = parseRatio(option.ratio);
  const scaled = multiplyFraction(baseFraction, multiplier);
  const amountNumber = scaled ? scaled.num / scaled.den : null;
  const amountStr = scaled ? formatFraction(scaled) : '';
  const displayName = pluralize(option.display, amountNumber ?? 0, option.unit);
  const unit = option.unit ? ` ${option.unit}` : '';
  return `${amountStr}${unit ? unit : ''} ${displayName}`.trim();
}

function buildChoiceControls(recipe, state, onChange) {
  const container = document.getElementById('choices-container');
  container.innerHTML = '';
  Object.entries(recipe.choices).forEach(([token, choice]) => {
    const wrapper = document.createElement('label');
    wrapper.className = 'choice-group';
    const select = document.createElement('select');
    select.dataset.token = token;
    recipe.ingredients[token].options
      .filter((opt) => opt.option)
      .forEach((opt) => {
        const optionEl = document.createElement('option');
        optionEl.value = opt.option;
        optionEl.textContent = opt.display;
        if (opt.option === choice.default_option) optionEl.selected = true;
        select.appendChild(optionEl);
      });
    select.addEventListener('change', () => {
      state.selectedOptions[token] = select.value;
      onChange();
    });
    const label = document.createElement('span');
    label.textContent = `${choice.label}: `;
    wrapper.appendChild(label);
    wrapper.appendChild(select);
    container.appendChild(wrapper);
    state.selectedOptions[token] = choice.default_option;
  });
}

function formatStepText(stepText, recipe, state) {
  return stepText.replace(/{{\s*([a-zA-Z0-9_-]+)\s*}}/g, (match, token) => {
    const option = selectOptionForToken(token, recipe, state);
    return renderIngredientEntry(option, state.multiplier);
  });
}

function selectOptionForToken(token, recipe, state) {
  const tokenData = recipe.ingredients[token];
  if (tokenData.isChoice) {
    const selected = state.selectedOptions[token] || recipe.choices[token]?.default_option;
    return tokenData.options.find((opt) => opt.option === selected) || tokenData.options[0];
  }
  return tokenData.options[0];
}

function renderIngredientsList(recipe, state) {
  const list = document.getElementById('ingredients-list');
  list.innerHTML = '';
  recipe.token_order.forEach((token) => {
    const option = selectOptionForToken(token, recipe, state);
    const li = document.createElement('li');
    li.textContent = renderIngredientEntry(option, state.multiplier);
    list.appendChild(li);
  });
}

function renderSteps(recipe, state) {
  const steps = document.getElementById('steps-list');
  steps.innerHTML = '';
  const stepLines = recipe.steps_raw.split(/\n/).filter((line) => line.trim() !== '');
  stepLines.forEach((line) => {
    const li = document.createElement('li');
    li.textContent = formatStepText(line.replace(/^\d+\.\s*/, ''), recipe, state);
    steps.appendChild(li);
  });
}

function renderRecipe(recipe) {
  const titleEl = document.getElementById('recipe-title');
  const notesEl = document.getElementById('notes');
  const multiplierInput = document.getElementById('multiplier');
  const state = {
    multiplier: Number(recipe.default_base) || 1,
    selectedOptions: {},
  };
  multiplierInput.value = state.multiplier;
  notesEl.textContent = recipe.notes || '';
  buildChoiceControls(recipe, state, () => {
    renderIngredientsList(recipe, state);
    renderSteps(recipe, state);
  });
  const rerender = () => {
    state.multiplier = Number(multiplierInput.value) || recipe.default_base;
    renderIngredientsList(recipe, state);
    renderSteps(recipe, state);
  };
  multiplierInput.addEventListener('input', rerender);
  rerender();
  titleEl.textContent = recipe.title;
  document.getElementById('print-btn').addEventListener('click', () => window.print());
}

async function main() {
  const recipeId = getRecipeIdFromQuery();
  const recipes = await loadRecipes();
  const recipe = recipes.find((r) => r.id === recipeId);
  if (!recipe) {
    document.body.innerHTML = '<p>Recipe not found</p>';
    return;
  }
  renderRecipe(recipe);
}

main().catch((err) => {
  document.body.innerHTML = `<p>${err.message || 'Failed to load recipe'}</p>`;
});

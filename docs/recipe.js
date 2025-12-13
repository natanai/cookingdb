function getQueryId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('id');
}

function parseAmount(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const trimmed = String(value).trim();
  const parts = trimmed.split(' ');
  let total = 0;
  for (const part of parts) {
    if (part.includes('/')) {
      const [num, den] = part.split('/').map(Number);
      if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) {
        total += num / den;
      }
    } else {
      const n = Number(part);
      if (Number.isFinite(n)) {
        total += n;
      }
    }
  }
  return total;
}

function formatFraction(value) {
  const rounded = Math.round(value * 16) / 16;
  const whole = Math.floor(rounded);
  const remainder = rounded - whole;
  if (remainder === 0) return `${whole}`;
  const numerator = Math.round(remainder * 16);
  const denominator = 16;
  if (whole === 0) return `${numerator}/${denominator}`;
  return `${whole} ${numerator}/${denominator}`;
}

function formatIngredient(row, multiplier) {
  const amount = parseAmount(row.ratio);
  const scaledAmount = amount === null ? null : amount * multiplier;
  const parts = [];
  if (scaledAmount !== null) {
    parts.push(formatFraction(scaledAmount));
  }
  if (row.unit && row.unit !== 'count') {
    parts.push(row.unit);
  }
  parts.push(row.display);
  return parts.filter(Boolean).join(' ');
}

function determineSelections(recipe) {
  const selections = {};
  const optionCounts = new Map();
  recipe.ingredients.forEach((row) => {
    const set = optionCounts.get(row.token) || new Set();
    set.add((row.option ?? '').trim());
    optionCounts.set(row.token, set);
  });

  recipe.ingredients.forEach((row) => {
    const options = optionCounts.get(row.token);
    if (options.size > 1) {
      const choice = recipe.choices.find((c) => c.token === row.token);
      selections[row.token] = selectionFromChoice(choice, options);
    }
  });

  return selections;
}

function selectionFromChoice(choice, options) {
  if (!choice) {
    return options.values().next().value;
  }
  if (options.has(choice.default_option)) {
    return choice.default_option;
  }
  return options.values().next().value;
}

function buildControls(recipe, state, onChange) {
  const container = document.getElementById('recipe-actions');
  container.innerHTML = '';

  const multiplierLabel = document.createElement('label');
  multiplierLabel.className = 'inline-control';
  multiplierLabel.textContent = 'Batch size';
  const multiplierInput = document.createElement('input');
  multiplierInput.type = 'number';
  multiplierInput.min = '0.1';
  multiplierInput.step = '0.25';
  multiplierInput.value = state.multiplier;
  multiplierInput.addEventListener('input', () => {
    const value = Number(multiplierInput.value) || recipe.meta.default_base || 1;
    state.multiplier = value;
    onChange();
  });
  multiplierLabel.appendChild(multiplierInput);
  container.append(multiplierLabel);

  recipe.choices.forEach((choice) => {
    const label = document.createElement('label');
    label.className = 'inline-control';
    label.textContent = choice.label;
    const select = document.createElement('select');
    const options = recipe.ingredients
      .filter((ing) => ing.token === choice.token)
      .map((ing) => ing.option || '');
    new Set(options).forEach((opt) => {
      const optionEl = document.createElement('option');
      optionEl.value = opt;
      optionEl.textContent = opt || 'default';
      select.appendChild(optionEl);
    });
    select.value = state.selections[choice.token];
    select.addEventListener('change', () => {
      state.selections[choice.token] = select.value;
      onChange();
    });
    label.appendChild(select);
    container.append(label);
  });

  const printBtn = document.createElement('button');
  printBtn.type = 'button';
  printBtn.className = 'button-link';
  printBtn.textContent = 'Print';
  printBtn.addEventListener('click', () => window.print());
  container.append(printBtn);
}

function selectedRowForToken(recipe, token, selection) {
  const rows = recipe.ingredients.filter((r) => r.token === token);
  if (rows.length === 0) return null;
  const match = rows.find((r) => (r.option ?? '').trim() === selection);
  return match || rows[0];
}

function orderTokensBySteps(steps) {
  const regex = /{{\s*([a-zA-Z0-9_-]+)\s*}}/g;
  const ordered = [];
  steps.forEach((step) => {
    let match;
    while ((match = regex.exec(step)) !== null) {
      if (!ordered.includes(match[1])) ordered.push(match[1]);
    }
  });
  return ordered;
}

function renderIngredients(recipe, state) {
  const list = document.getElementById('ingredient-list');
  list.innerHTML = '';
  const orderedTokens = orderTokensBySteps(recipe.steps);
  orderedTokens.forEach((token) => {
    const row = selectedRowForToken(recipe, token, state.selections[token]);
    if (!row) return;
    const li = document.createElement('li');
    li.textContent = formatIngredient(row, state.multiplier);
    list.appendChild(li);
  });
}

function replaceTokens(step, recipe, state) {
  return step.replace(/{{\s*([a-zA-Z0-9_-]+)\s*}}/g, (_, token) => {
    const row = selectedRowForToken(recipe, token, state.selections[token]);
    if (!row) return token;
    return formatIngredient(row, state.multiplier);
  });
}

function renderSteps(recipe, state) {
  const container = document.getElementById('steps');
  container.innerHTML = '';
  recipe.steps.forEach((step) => {
    const li = document.createElement('li');
    li.textContent = replaceTokens(step, recipe, state);
    container.appendChild(li);
  });
}

function initState(recipe) {
  const multiplier = Number(recipe.meta.default_base) || 1;
  return { multiplier, selections: determineSelections(recipe) };
}

async function init() {
  const id = getQueryId();
  const res = await fetch('./built/recipes.json');
  const recipes = await res.json();
  const recipe = recipes.find((r) => r.meta.id === id);
  if (!recipe) {
    document.getElementById('recipe-title').textContent = 'Recipe not found';
    return;
  }

  document.getElementById('recipe-title').textContent = recipe.meta.title;
  const state = initState(recipe);

  const rerender = () => {
    renderIngredients(recipe, state);
    renderSteps(recipe, state);
  };

  buildControls(recipe, state, rerender);
  rerender();
}

init();

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

function storageKeyForPan(recipe) {
  return `cookingdb.recipePan.${recipe.meta.id}`;
}

function computePanFactor(recipe, selectedPan) {
  if (!recipe.uses_pan) {
    return { factor: 1, warning: null };
  }

  const method = recipe.pan_scale_method || 'none';
  if (method === 'none') {
    return { factor: 1, warning: null };
  }

  const basePan = recipe.default_pan;
  if (!selectedPan || !basePan) {
    return { factor: 1, warning: 'Pan sizing unavailable; using recipe default amounts.' };
  }

  const areaFactor =
    selectedPan.area_in2 && basePan.area_in2 ? selectedPan.area_in2 / basePan.area_in2 : null;
  const volumeFactor =
    selectedPan.volume_in3 && basePan.volume_in3 ? selectedPan.volume_in3 / basePan.volume_in3 : null;

  if (method === 'area') {
    if (areaFactor) {
      return { factor: areaFactor, warning: null };
    }
    return { factor: 1, warning: 'Pan areas unknown; skipping pan scaling.' };
  }

  if (method === 'volume') {
    if (volumeFactor) {
      return { factor: volumeFactor, warning: null };
    }
    if (areaFactor) {
      return { factor: areaFactor, warning: 'Using area-based scaling (volume unavailable).' };
    }
    return { factor: 1, warning: 'Pan volumes unknown; skipping pan scaling.' };
  }

  return { factor: 1, warning: null };
}

function buildControls(recipe, state, pans, onChange) {
  const container = document.getElementById('recipe-actions');
  container.innerHTML = '';

  const mainRow = document.createElement('div');
  mainRow.className = 'controlRow';

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
  mainRow.append(multiplierLabel);

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
    mainRow.append(label);
  });

  const printBtn = document.createElement('button');
  printBtn.type = 'button';
  printBtn.className = 'button-link';
  printBtn.textContent = 'Print';
  printBtn.addEventListener('click', () => window.print());
  mainRow.append(printBtn);

  container.append(mainRow);

  if (recipe.uses_pan) {
    const panRow = document.createElement('div');
    panRow.id = 'panRow';
    panRow.className = 'controlRow';

    const label = document.createElement('label');
    label.className = 'inline-control';
    const title = document.createElement('span');
    title.className = 'pan-label';
    title.textContent = 'Pan';
    const select = document.createElement('select');
    pans.forEach((pan) => {
      const optionEl = document.createElement('option');
      optionEl.value = pan.pan_id;
      optionEl.textContent = pan.label;
      select.appendChild(optionEl);
    });
    if (state.selectedPanId) {
      select.value = state.selectedPanId;
    }
    select.addEventListener('change', () => {
      state.selectedPanId = select.value;
      localStorage.setItem(storageKeyForPan(recipe), state.selectedPanId);
      onChange();
    });

    label.appendChild(title);
    label.appendChild(select);
    panRow.append(label);
    panRow.hidden = false;
    container.append(panRow);
  }
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

function renderIngredients(recipe, state, totalScale) {
  const list = document.getElementById('ingredient-list');
  list.innerHTML = '';
  const orderedTokens = orderTokensBySteps(recipe.steps);
  orderedTokens.forEach((token) => {
    const row = selectedRowForToken(recipe, token, state.selections[token]);
    if (!row) return;
    const li = document.createElement('li');
    li.textContent = formatIngredient(row, totalScale);
    list.appendChild(li);
  });
}

function replaceTokens(step, recipe, state, totalScale) {
  return step.replace(/{{\s*([a-zA-Z0-9_-]+)\s*}}/g, (_, token) => {
    const row = selectedRowForToken(recipe, token, state.selections[token]);
    if (!row) return token;
    return formatIngredient(row, totalScale);
  });
}

function renderSteps(recipe, state, totalScale) {
  const container = document.getElementById('steps');
  container.innerHTML = '';
  recipe.steps.forEach((step) => {
    const li = document.createElement('li');
    li.textContent = replaceTokens(step, recipe, state, totalScale);
    container.appendChild(li);
  });
}

function renderPanSummary(recipe, state) {
  const summary = document.getElementById('pan-summary');
  if (!recipe.uses_pan) {
    summary.hidden = true;
    return;
  }

  summary.hidden = false;
  summary.innerHTML = '';
  const title = document.createElement('p');
  title.className = 'pan-title';
  title.textContent = `Pan: ${state.activePan ? state.activePan.label : 'Recipe default'}`;
  summary.appendChild(title);

  if (state.panWarning) {
    const note = document.createElement('p');
    note.className = 'pan-note';
    note.textContent = state.panWarning;
    summary.appendChild(note);
  } else if (state.panFactor && Math.abs(state.panFactor - 1) > 0.01) {
    const note = document.createElement('p');
    note.className = 'pan-note';
    note.textContent = `Scaled for pan size (×${state.panFactor.toFixed(2)})`;
    summary.appendChild(note);
  }
}

function initState(recipe, pans) {
  const multiplier = Number(recipe.meta.default_base) || 1;
  const selectedPanId = recipe.uses_pan
    ? localStorage.getItem(storageKeyForPan(recipe)) ||
      recipe.default_pan_id ||
      (pans[0] ? pans[0].pan_id : null)
    : null;
  return { multiplier, selections: determineSelections(recipe), selectedPanId, panFactor: 1, panWarning: null, activePan: null };
}

async function init() {
  const id = getQueryId();
  const [recipeRes, pansRes] = await Promise.all([
    fetch('./built/recipes.json'),
    fetch('./built/pans.json')
  ]);
  const recipes = await recipeRes.json();
  const pans = await pansRes.json();
  const pansMap = new Map(pans.map((p) => [p.pan_id, p]));
  const recipe = recipes.find((r) => r.meta.id === id);
  if (!recipe) {
    document.getElementById('recipe-title').textContent = 'Recipe not found';
    return;
  }

  document.getElementById('recipe-title').textContent = recipe.meta.title;
  const state = initState(recipe, pans);

  const syncPan = () => {
    if (!recipe.uses_pan) return;
    const storedPan = state.selectedPanId ? pansMap.get(state.selectedPanId) : null;
    const fallbackPan = recipe.default_pan_id ? pansMap.get(recipe.default_pan_id) : null;
    const firstPan = pans[0] || null;
    const chosenPan = storedPan || fallbackPan || firstPan;
    state.selectedPanId = chosenPan ? chosenPan.pan_id : null;
    const { factor, warning } = computePanFactor(recipe, chosenPan);
    state.panFactor = factor;
    state.panWarning = warning;
    state.activePan = chosenPan;
    if (state.selectedPanId) {
      localStorage.setItem(storageKeyForPan(recipe), state.selectedPanId);
    }
  };

  syncPan();

  const rerender = () => {
    syncPan();
    const totalScale = state.multiplier * (state.panFactor || 1);
    renderPanSummary(recipe, state);
    renderIngredients(recipe, state, totalScale);
    renderSteps(recipe, state, totalScale);
  };

  buildControls(recipe, state, pans, rerender);
  rerender();
}

init();

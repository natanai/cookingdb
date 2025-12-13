import MiniZip from './vendor/jszip-lite/index.js';

const state = {
  meta: {
    id: '',
    title: '',
    categories: '',
    default_base: '1',
    notes: ''
  },
  scratch: '',
  steps: '',
  ingredientRows: [createEmptyRow()],
  choiceGroups: {},
  catalog: []
};

function createEmptyRow() {
  return { token: '', option: '', display: '', ratio: '', unit: '', ingredient_id: '' };
}

const slugRegex = /^[a-z0-9-]+$/;
const tokenRegex = /^[a-zA-Z0-9_-]+$/;

function isValidRatio(value) {
  if (!value) return true;
  const trimmed = String(value).trim();
  if (trimmed === '') return true;
  const patterns = [
    /^\d+(\.\d+)?$/,
    /^\d+\/\d+$/,
    /^\d+\s+\d+\/\d+$/
  ];
  return patterns.some((p) => p.test(trimmed));
}

function escapeCsv(value) {
  const str = value == null ? '' : String(value);
  if (str.includes('"') || str.includes(',') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function categoriesToString(raw) {
  return raw
    .split(';')
    .map((c) => c.trim())
    .filter(Boolean)
    .join('; ');
}

function extractStepTokens(stepsText) {
  const regex = /{{\s*([a-zA-Z0-9_-]+)\s*}}/g;
  const tokens = new Set();
  let match;
  while ((match = regex.exec(stepsText))) {
    tokens.add(match[1]);
  }
  return tokens;
}

function computeOptionMap(rows) {
  const map = new Map();
  for (const row of rows) {
    const token = (row.token || '').trim();
    if (!token) continue;
    const option = (row.option || '').trim();
    const set = map.get(token) || new Set();
    set.add(option);
    map.set(token, set);
  }
  return map;
}

function renderIngredientRows() {
  const container = document.getElementById('ingredient-rows');
  container.innerHTML = '';

  state.ingredientRows.forEach((row, index) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'ingredient-row';

    const inputs = [
      { key: 'token', placeholder: 'flour' },
      { key: 'option', placeholder: 'whole-wheat' },
      { key: 'display', placeholder: '1 cup whole-wheat flour' },
      { key: 'ratio', placeholder: '1' },
      { key: 'unit', placeholder: 'cup' },
      { key: 'ingredient_id', placeholder: 'flour_whole_wheat' }
    ];

    inputs.forEach((meta) => {
      const input = document.createElement('input');
      input.value = row[meta.key] || '';
      input.placeholder = meta.placeholder;
      input.addEventListener('input', (e) => {
        state.ingredientRows[index][meta.key] = e.target.value;
        updateTokenSelector();
        renderChoiceGroups();
        updateValidation();
      });
      if (meta.key === 'ingredient_id') {
        input.setAttribute('list', 'ingredient-catalog');
      }
      rowEl.appendChild(input);
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'ghost remove-row';
    remove.textContent = '✕';
    remove.title = 'Remove row';
    remove.addEventListener('click', () => {
      state.ingredientRows.splice(index, 1);
      if (state.ingredientRows.length === 0) {
        state.ingredientRows.push(createEmptyRow());
      }
      updateTokenSelector();
      renderChoiceGroups();
      renderIngredientRows();
      updateValidation();
    });

    rowEl.appendChild(remove);
    container.appendChild(rowEl);
  });
}

function renderChoiceGroups() {
  const container = document.getElementById('choice-groups');
  container.innerHTML = '';
  const optionMap = computeOptionMap(state.ingredientRows);

  const entries = Object.entries(state.choiceGroups);
  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'section-sub';
    empty.textContent = 'No choice groups yet. Add when a token has multiple options.';
    container.appendChild(empty);
    return;
  }

  entries.forEach(([token, info]) => {
    const card = document.createElement('div');
    card.className = 'choice-card';

    const title = document.createElement('div');
    title.className = 'choice-title';
    title.textContent = token;

    const labelInput = document.createElement('input');
    labelInput.value = info.label || '';
    labelInput.placeholder = 'Label shown to readers';
    labelInput.addEventListener('input', (e) => {
      state.choiceGroups[token].label = e.target.value;
      updateValidation();
    });

    const defaultSelect = document.createElement('select');
    const options = Array.from(optionMap.get(token) || []);
    if (options.length === 0) options.push('');
    options.forEach((opt) => {
      const optionEl = document.createElement('option');
      optionEl.value = opt;
      optionEl.textContent = opt || '(blank default option)';
      if (opt === info.default_option) optionEl.selected = true;
      defaultSelect.appendChild(optionEl);
    });
    defaultSelect.addEventListener('change', (e) => {
      state.choiceGroups[token].default_option = e.target.value;
      updateValidation();
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'ghost';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      delete state.choiceGroups[token];
      renderChoiceGroups();
      updateValidation();
    });

    card.append(title, labelInput, defaultSelect, remove);
    container.appendChild(card);
  });
}

function addChoiceGroupPrompt() {
  const tokenRaw = prompt('Token name for this choice group?');
  const token = tokenRaw ? tokenRaw.trim() : '';
  if (!token || !tokenRegex.test(token)) return;
  const label = (prompt('Label shown to the cook (e.g. Milk type)?') || '').trim();
  const defaultOption = (prompt('Default option value (must match an option column)') || '').trim();
  state.choiceGroups[token] = { label, default_option: defaultOption };
  renderChoiceGroups();
  updateValidation();
}

function updateTokenSelector() {
  const select = document.getElementById('token-selector');
  const tokens = Array.from(computeOptionMap(state.ingredientRows).keys()).sort();
  select.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '-- select token --';
  select.appendChild(placeholder);
  tokens.forEach((token) => {
    const opt = document.createElement('option');
    opt.value = token;
    opt.textContent = token;
    select.appendChild(opt);
  });
}

function insertSelectedToken() {
  const select = document.getElementById('token-selector');
  const token = select.value;
  if (!token) return;
  const textarea = document.getElementById('recipe-steps');
  const insertion = `{{${token}}}`;
  const start = textarea.selectionStart || 0;
  const end = textarea.selectionEnd || 0;
  const value = textarea.value;
  textarea.value = value.slice(0, start) + insertion + value.slice(end);
  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = start + insertion.length;
  state.steps = textarea.value;
  updateValidation();
}

function ingredientCatalogList(items) {
  const list = document.createElement('ul');
  list.className = 'catalog-items';
  items.forEach((item) => {
    const li = document.createElement('li');
    const flags = [];
    if (item.contains_gluten) flags.push('gluten');
    if (item.contains_egg) flags.push('egg');
    if (item.contains_dairy) flags.push('dairy');
    const allergen = flags.length ? `Contains: ${flags.join(', ')}` : 'No major allergens';
    li.innerHTML = `<strong>${item.ingredient_id}</strong><br/><span>${item.canonical_name}</span><br/><small>${allergen}</small>`;
    list.appendChild(li);
  });
  return list;
}

function populateCatalog(data) {
  state.catalog = data;
  const container = document.getElementById('catalog-list');
  container.innerHTML = '';
  if (!data || data.length === 0) {
    container.textContent = 'No catalog data available.';
    return;
  }
  const list = ingredientCatalogList(data);
  container.appendChild(list);

  const datalist = document.createElement('datalist');
  datalist.id = 'ingredient-catalog';
  data.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.ingredient_id;
    option.label = item.canonical_name;
    datalist.appendChild(option);
  });
  document.body.appendChild(datalist);
}

function loadCatalog() {
  fetch('./built/ingredient_catalog.json')
    .then((res) => res.json())
    .then((data) => populateCatalog(data))
    .catch(() => {
      const container = document.getElementById('catalog-list');
      container.textContent = 'Unable to load ingredient catalog. Ensure you ran the build step.';
    });
}

function gatherMeta() {
  return {
    ...state.meta,
    id: document.getElementById('recipe-id').value.trim(),
    title: document.getElementById('recipe-title').value.trim(),
    categories: document.getElementById('recipe-categories').value,
    default_base: document.getElementById('recipe-base').value || '1',
    notes: document.getElementById('recipe-notes').value
  };
}

function validateState() {
  const errors = [];
  const meta = gatherMeta();

  if (!meta.id || !slugRegex.test(meta.id)) {
    errors.push('Recipe ID must be lowercase, numbers, and dashes only.');
  }
  if (!meta.title) {
    errors.push('Title is required.');
  }
  if (!meta.default_base || Number.isNaN(Number(meta.default_base))) {
    errors.push('Default base should be a number (use 1 for most recipes).');
  }

  const rows = state.ingredientRows.filter((r) => (r.token || '').trim() !== '');
  const optionMap = computeOptionMap(rows);
  const ingredientTokens = new Set(Array.from(optionMap.keys()));
  const stepsTokens = extractStepTokens(state.steps || '');

  for (const row of rows) {
    const token = (row.token || '').trim();
    if (token && !tokenRegex.test(token)) {
      errors.push(`Invalid token name: ${token}`);
    }
    if (!isValidRatio(row.ratio)) {
      errors.push(`Invalid ratio format on token ${token || '(blank)'}.`);
    }
  }

  ingredientTokens.forEach((token) => {
    if (!stepsTokens.has(token)) {
      errors.push(`Ingredient token "${token}" is missing from steps.`);
    }
  });

  stepsTokens.forEach((token) => {
    if (!ingredientTokens.has(token)) {
      errors.push(`Steps reference token "${token}" that is not in ingredients.`);
    }
  });

  optionMap.forEach((options, token) => {
    if (options.size > 1 && !state.choiceGroups[token]) {
      errors.push(`Token "${token}" has multiple options but no choice group with a default.`);
    }
  });

  Object.entries(state.choiceGroups).forEach(([token, info]) => {
    const options = optionMap.get(token) || new Set();
    if (options.size <= 1) {
      errors.push(`Choice group "${token}" exists but the token only has one option.`);
    }
    if (!options.has(info.default_option)) {
      errors.push(`Choice group "${token}" needs a default that matches an option value.`);
    }
  });

  return errors;
}

function updateValidation() {
  const messages = document.getElementById('validation-messages');
  messages.innerHTML = '';
  const errors = validateState();

  if (errors.length === 0) {
    const ok = document.createElement('li');
    ok.className = 'valid';
    ok.textContent = 'Looks good! Ready to export.';
    messages.appendChild(ok);
  } else {
    errors.forEach((err) => {
      const li = document.createElement('li');
      li.textContent = err;
      messages.appendChild(li);
    });
  }

  document.getElementById('download-zip').disabled = errors.length > 0;
}

function buildMetaCsv(meta) {
  const rows = [
    ['id', 'title', 'base_kind', 'default_base', 'categories', 'notes'],
    [meta.id, meta.title, 'multiplier', meta.default_base || '1', categoriesToString(meta.categories || ''), meta.notes || '']
  ];
  return rows.map((r) => r.map(escapeCsv).join(',')).join('\n');
}

function buildIngredientsCsv(rows) {
  const header = ['token', 'option', 'display', 'ratio', 'unit', 'ingredient_id'];
  const body = rows.map((row) => header.map((key) => escapeCsv(row[key] || '')).join(','));
  return [header.join(','), ...body].join('\n');
}

function buildChoicesCsv(choiceGroups) {
  const header = ['token', 'label', 'default_option'];
  const body = Object.entries(choiceGroups).map(([token, info]) =>
    [token, info.label || '', info.default_option || ''].map(escapeCsv).join(',')
  );
  return [header.join(','), ...body].join('\n');
}

function downloadZip() {
  const meta = gatherMeta();
  const rows = state.ingredientRows.map((row) => ({ ...row, token: (row.token || '').trim() })).filter((r) => r.token);
  const choiceGroups = state.choiceGroups;
  const steps = state.steps || '';
  const id = meta.id;

  const zip = new MiniZip();
  zip.file(`recipes/${id}/meta.csv`, buildMetaCsv(meta));
  zip.file(`recipes/${id}/ingredients.csv`, buildIngredientsCsv(rows));
  if (Object.keys(choiceGroups).length > 0) {
    zip.file(`recipes/${id}/choices.csv`, buildChoicesCsv(choiceGroups));
  }
  zip.file(`recipes/${id}/steps.md`, steps.trim() + '\n');

  zip.generateAsync({ type: 'blob' }).then((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${id || 'recipe'}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
}

function bindInputs() {
  document.getElementById('recipe-id').addEventListener('input', (e) => {
    state.meta.id = e.target.value;
    updateValidation();
  });
  document.getElementById('recipe-title').addEventListener('input', (e) => {
    state.meta.title = e.target.value;
    updateValidation();
  });
  document.getElementById('recipe-categories').addEventListener('input', (e) => {
    state.meta.categories = e.target.value;
  });
  document.getElementById('recipe-base').addEventListener('input', (e) => {
    state.meta.default_base = e.target.value;
    updateValidation();
  });
  document.getElementById('recipe-notes').addEventListener('input', (e) => {
    state.meta.notes = e.target.value;
  });
  document.getElementById('recipe-scratch').addEventListener('input', (e) => {
    state.scratch = e.target.value;
  });
  document.getElementById('recipe-steps').addEventListener('input', (e) => {
    state.steps = e.target.value;
    updateValidation();
  });
}

function initButtons() {
  document.getElementById('add-ingredient').addEventListener('click', () => {
    state.ingredientRows.push(createEmptyRow());
    renderIngredientRows();
    updateTokenSelector();
    renderChoiceGroups();
  });
  document.getElementById('add-choice-group').addEventListener('click', addChoiceGroupPrompt);
  document.getElementById('insert-token').addEventListener('click', insertSelectedToken);
  document.getElementById('download-zip').addEventListener('click', downloadZip);
}

function init() {
  bindInputs();
  renderIngredientRows();
  renderChoiceGroups();
  updateTokenSelector();
  updateValidation();
  initButtons();
  loadCatalog();
}

document.addEventListener('DOMContentLoaded', init);

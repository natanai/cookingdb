import {
  adminDeleteAllPending,
  adminDeletePendingByIds,
  adminExportPending,
  getRememberedPassword,
  setRememberedPassword,
} from './inbox/inbox-api.js';

const statusEl = document.getElementById('admin-status');
const tokenInput = document.getElementById('admin-token');
const rememberCheckbox = document.getElementById('remember-admin');
const loadBtn = document.getElementById('load-pending-btn');
const reloadBtn = document.getElementById('reload-pending-btn');
const pendingSection = document.getElementById('pending-section');
const pendingList = document.getElementById('pending-list');
const pendingCount = document.getElementById('pending-count');
const downloadBtn = document.getElementById('download-btn');
const wipePendingBtn = document.getElementById('wipe-pending-btn');

let currentPayload = null;

function showStatus(message, kind = 'info') {
  statusEl.textContent = message;
  statusEl.className = `status ${kind}`;
}

function getToken({ silent = false } = {}) {
  const token = tokenInput.value.trim();
  if (!token) {
    if (!silent) showStatus('Enter the admin token to open the pending inbox.', 'error');
    return null;
  }

  setRememberedPassword({
    kind: 'admin',
    value: token,
    remember: rememberCheckbox.checked,
  });
  return token;
}

function unwrapRecipe(item) {
  if (!item || typeof item !== 'object') return null;
  if (item.recipe && typeof item.recipe === 'object') return item.recipe;
  if (item.payload && typeof item.payload === 'object') {
    if (item.payload.payload && typeof item.payload.payload === 'object') return item.payload.payload;
    if (item.payload.recipe && typeof item.payload.recipe === 'object') return item.payload.recipe;
    return item.payload;
  }
  return item;
}

function sourceItems(payload) {
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.pending)) return payload.pending;
  return [];
}

function recipeIngredientCount(recipe) {
  if (Array.isArray(recipe?.ingredients)) return recipe.ingredients.length;
  if (recipe?.ingredients && typeof recipe.ingredients === 'object') {
    return Object.values(recipe.ingredients).reduce((count, entry) => {
      const options = Array.isArray(entry?.options) ? entry.options.length : 1;
      return count + Math.max(options, 1);
    }, 0);
  }
  return 0;
}

function recipeStepCount(recipe) {
  if (Array.isArray(recipe?.steps)) return recipe.steps.filter((step) => step?.text).length;
  return String(recipe?.steps_raw || '')
    .split(/\r?\n/)
    .filter((line) => line.trim()).length;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function buildRepoImportBundle(payload) {
  const items = sourceItems(payload).map((item) => {
    const recipe = unwrapRecipe(item) || {};
    const recipeId =
      recipe.id ||
      recipe.recipe_id ||
      item.recipe_id ||
      item.slug ||
      (typeof item.id === 'string' ? item.id : '');

    return {
      inbox_id: Number.isInteger(item.inbox_id)
        ? item.inbox_id
        : Number.isInteger(item.id)
          ? item.id
          : null,
      recipe_id: recipeId,
      title: recipe.title || item.title || '',
      recipe: { ...recipe, id: recipeId || recipe.id },
    };
  });

  return {
    format: 'cookingdb-recipe-import',
    version: 1,
    exported_at: new Date().toISOString(),
    source: 'cookingdb-inbox',
    items,
  };
}

function downloadJsonFile(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const today = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `cookingdb-recipe-import-${today}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function renderEmptyState() {
  pendingList.innerHTML = '';
  const empty = document.createElement('div');
  empty.className = 'pending-empty';
  empty.innerHTML = '<strong>Nothing is waiting.</strong><span>New recipe submissions will appear here before they are published.</span>';
  pendingList.appendChild(empty);
}

async function deletePendingItem(item, recipe) {
  const token = getToken();
  if (!token) return;

  const title = recipe?.title || item.title || `Pending recipe #${item.id}`;
  const confirmed = window.confirm(
    `Delete “${title}” from the pending inbox? This cannot be undone.`
  );
  if (!confirmed) return;

  try {
    showStatus(`Deleting “${title}”…`, 'info');
    await adminDeletePendingByIds({ adminToken: token, ids: [item.id] });
    await loadPending({ quiet: true });
    showStatus(`Deleted “${title}”.`, 'success');
  } catch (err) {
    showStatus(err.message || 'Unable to delete pending recipe', 'error');
  }
}

function renderPending(payload) {
  currentPayload = payload;
  const items = sourceItems(payload);
  pendingSection.hidden = false;
  pendingCount.textContent = `${items.length} pending recipe${items.length === 1 ? '' : 's'}`;
  pendingList.innerHTML = '';

  if (!items.length) {
    renderEmptyState();
    return;
  }

  items.forEach((item) => {
    const recipe = unwrapRecipe(item) || {};
    const title = recipe.title || item.title || `Pending recipe #${item.id}`;
    const recipeId = recipe.id || recipe.recipe_id || item.slug || '';
    const categories = Array.isArray(recipe.categories) ? recipe.categories.filter(Boolean) : [];
    const ingredientCount = recipeIngredientCount(recipe);
    const stepCount = recipeStepCount(recipe);

    const row = document.createElement('article');
    row.className = 'pending-recipe-row';

    const main = document.createElement('div');
    main.className = 'pending-recipe-main';

    const heading = document.createElement('h3');
    heading.className = 'pending-recipe-title';
    heading.textContent = title;

    const meta = document.createElement('div');
    meta.className = 'pending-recipe-meta';
    const bits = [
      recipeId ? `ID: ${recipeId}` : '',
      `${ingredientCount} ingredient${ingredientCount === 1 ? '' : 's'}`,
      `${stepCount} step${stepCount === 1 ? '' : 's'}`,
      formatDate(item.updated_at || item.created_at),
    ].filter(Boolean);
    meta.textContent = bits.join(' · ');

    main.append(heading, meta);

    if (categories.length) {
      const categoryLine = document.createElement('div');
      categoryLine.className = 'pending-recipe-categories';
      categoryLine.textContent = categories.join(' · ');
      main.appendChild(categoryLine);
    }

    const actions = document.createElement('div');
    actions.className = 'pending-recipe-actions';

    const edit = document.createElement('a');
    edit.className = 'button secondary';
    edit.href = `add.html?adminEdit=${encodeURIComponent(item.id)}&review=1`;
    edit.textContent = 'Review / edit';

    const remove = document.createElement('button');
    remove.className = 'button danger-text';
    remove.type = 'button';
    remove.textContent = 'Delete';
    remove.addEventListener('click', () => deletePendingItem(item, recipe));

    actions.append(edit, remove);
    row.append(main, actions);
    pendingList.appendChild(row);
  });
}

async function loadPending({ quiet = false } = {}) {
  const token = getToken({ silent: quiet });
  if (!token) return;

  loadBtn.disabled = true;
  if (reloadBtn) reloadBtn.disabled = true;
  if (!quiet) showStatus('Loading pending recipes…', 'info');

  try {
    const payload = await adminExportPending({ adminToken: token });
    renderPending(payload);
    showStatus('Inbox loaded.', 'success');
  } catch (err) {
    currentPayload = null;
    pendingSection.hidden = true;
    showStatus(err.message || 'Unable to load pending recipes', 'error');
  } finally {
    loadBtn.disabled = false;
    if (reloadBtn) reloadBtn.disabled = false;
  }
}

async function handleDownload() {
  const token = getToken();
  if (!token) return;

  try {
    showStatus('Preparing repo-ready recipe export…', 'info');
    const payload = await adminExportPending({ adminToken: token });
    renderPending(payload);
    const bundle = buildRepoImportBundle(payload);
    downloadJsonFile(bundle);
    showStatus(
      `Downloaded ${bundle.items.length} pending recipe${bundle.items.length === 1 ? '' : 's'} in the official import format.`,
      'success'
    );
  } catch (err) {
    showStatus(err.message || 'Unable to download recipes', 'error');
  }
}

async function handleWipePending() {
  const token = getToken();
  if (!token) return;

  const confirmation = window.prompt(
    'Type DELETE ALL to permanently delete every pending inbox entry. This cannot be undone.'
  );
  if (confirmation !== 'DELETE ALL') {
    showStatus('Deletion cancelled. Type DELETE ALL to confirm.', 'info');
    return;
  }

  try {
    showStatus('Deleting all pending inbox entries…', 'info');
    const deletion = await adminDeleteAllPending({ adminToken: token });
    const deletedCount = typeof deletion?.deleted === 'number' ? deletion.deleted : 0;
    await loadPending({ quiet: true });
    showStatus(
      `Deleted ${deletedCount} pending entr${deletedCount === 1 ? 'y' : 'ies'}.`,
      'success'
    );
  } catch (err) {
    showStatus(err.message || 'Unable to delete pending inbox entries', 'error');
  }
}

function bootstrap() {
  tokenInput.value = getRememberedPassword('admin');
  if (tokenInput.value) {
    rememberCheckbox.checked = Boolean(localStorage.getItem('cookingdb-admin-password'));
  }

  loadBtn.addEventListener('click', () => loadPending());
  reloadBtn.addEventListener('click', () => loadPending());
  downloadBtn.addEventListener('click', handleDownload);
  wipePendingBtn.addEventListener('click', handleWipePending);
  tokenInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      loadPending();
    }
  });

  if (tokenInput.value) {
    loadPending({ quiet: true });
  }
}

bootstrap();

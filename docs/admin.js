import {
  adminDeleteAllPending,
  adminExportPending,
  getRememberedPassword,
  setRememberedPassword,
} from './inbox/inbox-api.js';

const statusEl = document.getElementById('admin-status');
const tokenInput = document.getElementById('admin-token');
const rememberCheckbox = document.getElementById('remember-admin');
const downloadBtn = document.getElementById('download-btn');
const wipePendingBtn = document.getElementById('wipe-pending-btn');

function showStatus(message, kind = 'info') {
  statusEl.textContent = message;
  statusEl.className = `status ${kind}`;
}

function getToken() {
  const token = tokenInput.value.trim();
  if (!token) {
    showStatus('Please paste the admin token.', 'error');
    return null;
  }
  if (rememberCheckbox.checked) {
    setRememberedPassword({ kind: 'admin', value: token, remember: true });
  } else {
    setRememberedPassword({ kind: 'admin', value: token, remember: false });
  }
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

function buildRepoImportBundle(payload) {
  const sourceItems = Array.isArray(payload?.items)
    ? payload.items
    : Array.isArray(payload?.pending)
      ? payload.pending
      : [];

  const items = sourceItems.map((item) => {
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

async function handleDownload() {
  const token = getToken();
  if (!token) return;
  try {
    showStatus('Preparing repo-ready recipe export...', 'info');
    const payload = await adminExportPending({ adminToken: token });
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
    'Type DELETE to permanently delete all pending inbox entries. This cannot be undone.'
  );
  if (confirmation !== 'DELETE') {
    showStatus('Deletion cancelled. Type DELETE to confirm.', 'info');
    return;
  }

  try {
    showStatus('Deleting pending inbox entries...', 'info');
    const deletion = await adminDeleteAllPending({ adminToken: token });
    const deletedCount = typeof deletion?.deleted === 'number' ? deletion.deleted : 0;

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
    rememberCheckbox.checked = true;
  }
  downloadBtn.addEventListener('click', handleDownload);
  wipePendingBtn.addEventListener('click', handleWipePending);
}

bootstrap();

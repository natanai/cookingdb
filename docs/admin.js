import {
  adminDelete,
  adminExportPending,
  adminMarkImported,
  getRememberedPassword,
  setRememberedPassword,
} from './inbox/inbox-api.js';

const statusEl = document.getElementById('admin-status');
const tokenInput = document.getElementById('admin-token');
const rememberCheckbox = document.getElementById('remember-admin');
const downloadBtn = document.getElementById('download-btn');
const markImportedBtn = document.getElementById('mark-imported-btn');
const deleteBtn = document.getElementById('delete-btn');

let lastExportIds = [];

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

function extractIds(payload) {
  if (!payload) return [];
  const list = Array.isArray(payload)
    ? payload
    : payload.rows || payload.pending || payload.recipes || payload.items || payload.data;

  if (!Array.isArray(list)) return [];
  const ids = list
    .map((entry) => entry?.id
      ?? entry?.key
      ?? entry?.recipe_id
      ?? entry?.recipe?.id
      ?? entry?.payload?.id
      ?? entry?.payload?.recipe_id
      ?? entry?.payload?.recipe?.id)
    .filter(Boolean);

  return Array.from(new Set(ids));
}

function downloadJsonFile(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const today = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `cookingdb-inbox-export-${today}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function handleDownload() {
  const token = getToken();
  if (!token) return;
  try {
    showStatus('Downloading pending recipes...', 'info');
    const payload = await adminExportPending({ adminToken: token });
    downloadJsonFile(payload);
    lastExportIds = extractIds(payload);
    if (lastExportIds.length === 0) {
      console.warn('Admin export did not contain any recipe IDs.');
      showStatus('Export downloaded but no recipe IDs were found. Nothing will be marked or deleted.', 'info');
    } else {
      showStatus('Export downloaded. You can mark these as imported or delete them.', 'success');
    }
    markImportedBtn.disabled = lastExportIds.length === 0;
    deleteBtn.disabled = lastExportIds.length === 0;
  } catch (err) {
    showStatus(err.message || 'Unable to download recipes', 'error');
    lastExportIds = [];
    markImportedBtn.disabled = true;
    deleteBtn.disabled = true;
  }
}

async function handleMarkImported() {
  const token = getToken();
  if (!token) return;
  if (lastExportIds.length === 0) {
    console.warn('Mark imported requested but no recipe IDs are available.');
    showStatus('No recipe IDs are available to mark as imported. Please download an export first.', 'info');
    return;
  }
  try {
    showStatus('Marking recipes as imported...', 'info');
    await adminMarkImported({ adminToken: token, ids: lastExportIds });
    showStatus('Marked as imported.', 'success');
  } catch (err) {
    showStatus(err.message || 'Unable to mark as imported', 'error');
  }
}

async function handleDelete() {
  const token = getToken();
  if (!token) return;
  if (lastExportIds.length === 0) {
    console.warn('Delete requested but no recipe IDs are available.');
    showStatus('No recipe IDs are available to delete. Please download an export first.', 'info');
    return;
  }
  try {
    showStatus('Deleting recipes from inbox...', 'info');
    await adminDelete({ adminToken: token, ids: lastExportIds });
    showStatus('Deleted imported recipes.', 'success');
  } catch (err) {
    showStatus(err.message || 'Unable to delete recipes', 'error');
  }
}

function bootstrap() {
  tokenInput.value = getRememberedPassword('admin');
  if (tokenInput.value) {
    rememberCheckbox.checked = true;
  }
  downloadBtn.addEventListener('click', handleDownload);
  markImportedBtn.addEventListener('click', handleMarkImported);
  deleteBtn.addEventListener('click', handleDelete);
}

bootstrap();

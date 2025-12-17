import {
  adminDeletePendingByIds,
  adminExportPending,
  adminPurgeImported,
  getRememberedPassword,
  setRememberedPassword,
} from './inbox/inbox-api.js';

const statusEl = document.getElementById('admin-status');
const tokenInput = document.getElementById('admin-token');
const rememberCheckbox = document.getElementById('remember-admin');
const downloadBtn = document.getElementById('download-btn');
const purgeBtn = document.getElementById('purge-btn');
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
    showStatus('Export downloaded as a JSON file.', 'success');
  } catch (err) {
    showStatus(err.message || 'Unable to download recipes', 'error');
  }
}

async function handlePurgeImported() {
  const token = getToken();
  if (!token) return;
  const confirmed = window.confirm('Permanently delete imported inbox entries?');
  if (!confirmed) return;
  try {
    showStatus('Purging imported inbox entries...', 'info');
    await adminPurgeImported({ adminToken: token });
    showStatus('Imported inbox entries purged.', 'success');
  } catch (err) {
    showStatus(err.message || 'Unable to purge inbox entries', 'error');
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
    showStatus('Loading pending inbox entries...', 'info');
    const payload = await adminExportPending({ adminToken: token });
    const ids = Array.isArray(payload?.items)
      ? payload.items.map((row) => row.id).filter((id) => Number.isInteger(id))
      : [];

    if (ids.length === 0) {
      showStatus('Nothing to delete. No pending entries found.', 'success');
      return;
    }

    const deletion = await adminDeletePendingByIds({ adminToken: token, ids });
    const deletedCount =
      typeof deletion?.deleted === 'number'
        ? deletion.deleted
        : typeof deletion?.attempted === 'number'
          ? deletion.attempted
          : ids.length;

    showStatus(`Deleted ${deletedCount} pending entr${deletedCount === 1 ? 'y' : 'ies'}. Refreshing...`, 'info');
    const remaining = await adminExportPending({ adminToken: token });
    const remainingCount = Array.isArray(remaining?.items) ? remaining.items.length : 0;
    showStatus(`Deleted ${deletedCount} pending entries. Remaining pending: ${remainingCount}.`, 'success');
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
  purgeBtn.addEventListener('click', handlePurgeImported);
  wipePendingBtn.addEventListener('click', handleWipePending);
}

bootstrap();

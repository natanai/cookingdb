import {
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
  const confirmed = window.confirm('Permanently delete all imported inbox entries?');
  if (!confirmed) return;
  try {
    showStatus('Purging imported inbox entries...', 'info');
    await adminPurgeImported({ adminToken: token });
    showStatus('Imported inbox entries purged.', 'success');
  } catch (err) {
    showStatus(err.message || 'Unable to purge imported entries', 'error');
  }
}

function bootstrap() {
  tokenInput.value = getRememberedPassword('admin');
  if (tokenInput.value) {
    rememberCheckbox.checked = true;
  }
  downloadBtn.addEventListener('click', handleDownload);
  purgeBtn.addEventListener('click', handlePurgeImported);
}

bootstrap();

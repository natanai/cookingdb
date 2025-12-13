const DEFAULT_BASE_URL = 'https://cookingdb-inbox.natanai.workers.dev';
const PATHS = {
  familySubmit: '/api/family/submit',
  familyList: '/api/family/list',
  adminExport: '/api/admin/export',
  adminMarkImported: '/api/admin/mark-imported',
  adminDelete: '/api/admin/delete',
};

function storageKey(kind) {
  return `cookingdb-${kind}-password`;
}

export function setRememberedPassword({ kind, value, remember }) {
  if (!['family', 'admin'].includes(kind)) return;
  const key = storageKey(kind);
  if (remember && value) {
    localStorage.setItem(key, value);
    sessionStorage.setItem(key, value);
  } else if (value) {
    sessionStorage.setItem(key, value);
    localStorage.removeItem(key);
  } else {
    sessionStorage.removeItem(key);
    localStorage.removeItem(key);
  }
}

export function getRememberedPassword(kind) {
  const key = storageKey(kind);
  return sessionStorage.getItem(key) || localStorage.getItem(key) || '';
}

function buildUrl(path, workerBaseUrl) {
  const base = workerBaseUrl || DEFAULT_BASE_URL;
  return `${base.replace(/\/$/, '')}${path}`;
}

async function postJson(pathKey, { workerBaseUrl, payload }) {
  const url = buildUrl(PATHS[pathKey], workerBaseUrl);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const message = data?.error || data?.message || res.statusText;
      throw new Error(message || 'Request failed');
    }
    return data;
  } catch (err) {
    if (err instanceof TypeError) {
      throw new Error('Network error or CORS blocked the request. Please try again later.');
    }
    throw err;
  }
}

export function familySubmitRecipe({ workerBaseUrl = DEFAULT_BASE_URL, familyPassword, recipe }) {
  return postJson('familySubmit', {
    workerBaseUrl,
    payload: { password: familyPassword, recipe },
  });
}

export function familyListPending({ workerBaseUrl = DEFAULT_BASE_URL, familyPassword, includePayload = false }) {
  return postJson('familyList', {
    workerBaseUrl,
    payload: { password: familyPassword, include_payload: includePayload },
  });
}

export function adminExportPending({ workerBaseUrl = DEFAULT_BASE_URL, adminToken }) {
  return postJson('adminExport', {
    workerBaseUrl,
    payload: { token: adminToken },
  });
}

export function adminMarkImported({ workerBaseUrl = DEFAULT_BASE_URL, adminToken, ids }) {
  return postJson('adminMarkImported', {
    workerBaseUrl,
    payload: { token: adminToken, ids },
  });
}

export function adminDelete({ workerBaseUrl = DEFAULT_BASE_URL, adminToken, ids }) {
  return postJson('adminDelete', {
    workerBaseUrl,
    payload: { token: adminToken, ids },
  });
}

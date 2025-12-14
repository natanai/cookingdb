const DEFAULT_BASE_URL = 'https://cookingdb-inbox.natanai.workers.dev';
const PATHS = {
  familySubmit: '/api/add',
  familyList: '/api/list',
  adminExport: '/admin/export',
  adminMarkImported: '/admin/mark-imported',
  adminDelete: '/admin/purge-imported',
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
    return;
  }

  if (value) {
    sessionStorage.setItem(key, value);
    localStorage.removeItem(key);
    return;
  }

  sessionStorage.removeItem(key);
  localStorage.removeItem(key);
}

export function getRememberedPassword(kind) {
  const key = storageKey(kind);
  return sessionStorage.getItem(key) || localStorage.getItem(key) || '';
}

function buildUrl(path, workerBaseUrl) {
  const base = workerBaseUrl || DEFAULT_BASE_URL;
  return `${base.replace(/\/$/, '')}${path}`;
}

async function postJson(pathKey, { workerBaseUrl, payload, password, adminToken }) {
  const url = buildUrl(PATHS[pathKey], workerBaseUrl);

  const headers = { 'Content-Type': 'application/json' };
  if (password) headers['X-Recipe-Password'] = password;
  if (adminToken) headers['X-Admin-Token'] = adminToken;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload || {}),
  });

  const contentType = (res.headers.get('content-type') || '').toLowerCase();

  let data;
  if (contentType.includes('application/json')) {
    data = await res.json();
  } else {
    const text = await res.text();
    data = text ? { ok: false, error: text } : null;
  }

  if (!res.ok) {
    throw new Error((data && data.error) ? data.error : `Request failed (${res.status})`);
  }
  if (data && data.ok === false) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

export function familySubmitRecipe({ workerBaseUrl = DEFAULT_BASE_URL, familyPassword, recipe }) {
  return postJson('familySubmit', {
    workerBaseUrl,
    password: familyPassword,
    payload: { title: recipe.title, payload: recipe },
  });
}

export function familyListPending({
  workerBaseUrl = DEFAULT_BASE_URL,
  familyPassword,
  includePayload = false,
}) {
  return postJson('familyList', {
    workerBaseUrl,
    password: familyPassword,
    payload: { status: 'pending', include_payload: includePayload },
  });
}

export function adminExportPending({ workerBaseUrl = DEFAULT_BASE_URL, adminToken }) {
  return postJson('adminExport', {
    workerBaseUrl,
    adminToken,
    payload: { status: 'pending', include_payload: true },
  });
}

export function adminMarkImported({ workerBaseUrl = DEFAULT_BASE_URL, adminToken, ids }) {
  return postJson('adminMarkImported', {
    workerBaseUrl,
    adminToken,
    payload: { ids },
  });
}

export function adminDelete({ workerBaseUrl = DEFAULT_BASE_URL, adminToken, ids }) {
  return postJson('adminDelete', {
    workerBaseUrl,
    adminToken,
    payload: { ids },
  });
}

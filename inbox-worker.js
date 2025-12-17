const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Recipe-Password, X-Admin-Token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ROUTES = {
  '/api/add': familySubmit,
  '/api/list': familyList,
  '/admin/export': adminExport,
  '/admin/mark-imported': adminMarkImported,
  '/admin/purge-imported': adminPurgeImported,
  '/admin/wipe': adminWipe,
};

const INBOX_STORAGE_KEY = 'submissions';

function jsonResponse(body, init = {}) {
  const headers = { 'Content-Type': 'application/json', ...CORS_HEADERS, ...(init.headers || {}) };
  return new Response(JSON.stringify(body), { ...init, headers });
}

function errorResponse(message, status = 400) {
  return jsonResponse({ ok: false, error: message }, { status });
}

function getKv(env) {
  if (!env) return null;
  if (env.INBOX?.get && env.INBOX?.put) return env.INBOX;
  if (env.STORAGE?.get && env.STORAGE?.put) return env.STORAGE;
  if (env.DB?.get && env.DB?.put) return env.DB;
  return null;
}

async function readSubmissions(env) {
  const kv = getKv(env);
  if (!kv) return [];
  const stored = await kv.get(INBOX_STORAGE_KEY);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Failed to parse submissions', err);
    return [];
  }
}

async function writeSubmissions(env, submissions) {
  const kv = getKv(env);
  if (!kv) return;
  await kv.put(INBOX_STORAGE_KEY, JSON.stringify(submissions));
}

async function requireAdmin(request, env) {
  const provided = request.headers.get('X-Admin-Token');
  const expected = env?.ADMIN_TOKEN;
  if (!expected) {
    throw new Error('Admin token not configured');
  }
  if (!provided || provided !== expected) {
    throw new Error('Invalid admin token');
  }
}

async function parseJson(request) {
  try {
    return await request.json();
  } catch (err) {
    throw new Error('Invalid JSON payload');
  }
}

function withCors(response) {
  const headers = new Headers(response.headers);
  Object.entries(CORS_HEADERS).forEach(([key, value]) => headers.set(key, value));
  return new Response(response.body, { ...response, headers });
}

async function familySubmit(request, env, body) {
  const submissions = await readSubmissions(env);
  const recipe = body?.payload;
  if (!recipe || !recipe.id) {
    return errorResponse('Missing recipe payload');
  }
  const id = recipe.id;
  submissions.push({ id, status: 'pending', payload: recipe });
  await writeSubmissions(env, submissions);
  return jsonResponse({ ok: true, id });
}

async function familyList(request, env, body) {
  const submissions = await readSubmissions(env);
  const status = body?.status || 'pending';
  const includePayload = body?.include_payload;
  const filtered = submissions.filter((item) => item.status === status);
  const results = includePayload ? filtered : filtered.map(({ payload, ...rest }) => rest);
  return jsonResponse({ ok: true, submissions: results });
}

async function adminExport(request, env, body) {
  await requireAdmin(request, env);
  return familyList(request, env, body);
}

async function adminMarkImported(request, env, body) {
  await requireAdmin(request, env);
  const ids = Array.isArray(body?.ids) ? new Set(body.ids) : new Set();
  if (!ids.size) return errorResponse('No ids provided');
  const submissions = await readSubmissions(env);
  let updated = 0;
  const next = submissions.map((entry) => {
    if (ids.has(entry.id)) {
      updated += 1;
      return { ...entry, status: 'imported' };
    }
    return entry;
  });
  await writeSubmissions(env, next);
  return jsonResponse({ ok: true, updated });
}

async function adminPurgeImported(request, env, body) {
  await requireAdmin(request, env);
  const ids = Array.isArray(body?.ids) ? new Set(body.ids) : new Set();
  if (!ids.size) return errorResponse('No ids provided');
  const submissions = await readSubmissions(env);
  const remaining = submissions.filter((entry) => !ids.has(entry.id));
  const removed = submissions.length - remaining.length;
  await writeSubmissions(env, remaining);
  return jsonResponse({ ok: true, removed });
}

async function adminWipe(request, env, body) {
  await requireAdmin(request, env);
  const submissions = await readSubmissions(env);
  const remaining = submissions.filter((entry) => entry.status !== 'pending');
  const removed = submissions.length - remaining.length;
  await writeSubmissions(env, remaining);
  return jsonResponse({ ok: true, removed });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== 'POST') {
      return withCors(new Response('Not found', { status: 404 }));
    }

    const url = new URL(request.url);
    const handler = ROUTES[url.pathname];
    if (!handler) {
      return withCors(new Response('Not found', { status: 404 }));
    }

    let body;
    try {
      body = await parseJson(request);
    } catch (err) {
      return errorResponse(err.message);
    }

    try {
      return await handler(request, env, body);
    } catch (err) {
      const message = err?.message || 'Unexpected error';
      const status = message.toLowerCase().includes('token') ? 401 : 500;
      return errorResponse(message, status);
    }
  },
};

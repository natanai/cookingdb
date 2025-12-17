const ALLOWED_ORIGINS = ['https://natanai.github.io'];

function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Recipe-Password, X-Admin-Token',
    Vary: 'Origin',
  });

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
  }

  return headers;
}

function jsonResponse(request, body, init = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  corsHeaders(request).forEach((value, key) => headers.set(key, value));
  if (init.headers) {
    Object.entries(init.headers).forEach(([key, value]) => headers.set(key, value));
  }

  return new Response(JSON.stringify(body), { ...init, headers });
}

function textResponse(request, body, init = {}) {
  const headers = new Headers();
  corsHeaders(request).forEach((value, key) => headers.set(key, value));
  if (init.headers) {
    Object.entries(init.headers).forEach(([key, value]) => headers.set(key, value));
  }

  return new Response(body, { ...init, headers });
}

function slugify(text, fallback = 'recipe') {
  const slug = (text || '')
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || fallback;
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);

  return `{${entries.join(',')}}`;
}

async function sha256Hex(value) {
  const encoder = new TextEncoder();
  const buffer = encoder.encode(value);
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function requireRecipePassword(request, env) {
  const provided = request.headers.get('X-Recipe-Password');
  const expected = env?.RECIPE_PASSWORD;

  if (!expected) {
    throw new Error('Recipe password not configured');
  }

  if (!provided || provided !== expected) {
    throw new Error('Invalid recipe password');
  }
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

function getDb(env) {
  const db = env?.INBOX_DB || env?.DB;
  if (!db?.prepare) {
    throw new Error('Database binding missing');
  }
  return db;
}

async function ensureInboxTable(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS inbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipe_id TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        content_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      )`
    )
    .run();
}

async function parseJson(request) {
  try {
    return await request.json();
  } catch (err) {
    throw new Error('Invalid JSON payload');
  }
}

async function resolveRecipeId(db, desiredId) {
  const base = slugify(desiredId);
  let candidate = base;
  let suffix = 2;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await db.prepare('SELECT 1 FROM inbox WHERE recipe_id = ?').bind(candidate).first();
    if (!existing) return candidate;
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}

function unwrapRecipeEnvelope(body) {
  if (!body || typeof body !== 'object') return null;
  if (body.payload && typeof body.payload === 'object') return body.payload;
  if (body.recipe && typeof body.recipe === 'object') return body.recipe;
  return body;
}

async function familySubmit(request, env, body) {
  await requireRecipePassword(request, env);
  const db = getDb(env);
  await ensureInboxTable(db);

  const envelope = unwrapRecipeEnvelope(body);
  const recipe = envelope?.payload || envelope;

  if (!recipe || !recipe.title) {
    return jsonResponse(request, { ok: false, error: 'Missing recipe payload' }, { status: 400 });
  }

  const title = recipe.title;
  const desiredId = recipe.id || recipe.recipe_id || slugify(title);
  const recipeId = await resolveRecipeId(db, desiredId);

  const canonical = stableStringify({ title, payload: recipe });
  const contentHash = await sha256Hex(canonical);

  const existing = await db.prepare('SELECT recipe_id FROM inbox WHERE content_hash = ?').bind(contentHash).first();
  if (existing) {
    return jsonResponse(request, { ok: true, id: existing.recipe_id, status: 'duplicate' });
  }

  const payloadToStore = { title, payload: { ...recipe, id: recipeId, recipe_id: recipeId, content_hash: contentHash } };

  await db
    .prepare('INSERT INTO inbox (recipe_id, title, payload, status, content_hash) VALUES (?, ?, ?, ?, ?)')
    .bind(recipeId, title, JSON.stringify(payloadToStore), 'pending', contentHash)
    .run();

  return jsonResponse(request, { ok: true, id: recipeId, content_hash: contentHash });
}

async function listSubmissions(request, env, body, { requirePassword = true } = {}) {
  if (requirePassword) {
    await requireRecipePassword(request, env);
  }
  const db = getDb(env);
  await ensureInboxTable(db);

  const status = body?.status || 'pending';
  const includePayload = Boolean(body?.include_payload);

  const rows = await db
    .prepare(
      'SELECT recipe_id, title, payload, status, content_hash FROM inbox WHERE status = ? ORDER BY created_at DESC, id DESC'
    )
    .bind(status)
    .all();

  const items = (rows?.results || []).map((row) => {
    const base = {
      id: row.recipe_id,
      recipe_id: row.recipe_id,
      title: row.title,
      status: row.status,
      content_hash: row.content_hash,
    };

    if (!includePayload) return base;

    try {
      const stored = JSON.parse(row.payload);
      const recipe = stored?.payload || stored?.recipe || stored;
      return { ...base, recipe, payload: stored };
    } catch (err) {
      return base;
    }
  });

  return jsonResponse(request, { ok: true, pending: items });
}

async function adminExport(request, env, body) {
  await requireAdmin(request, env);
  return listSubmissions(request, env, body, { requirePassword: false });
}

async function adminMarkImported(request, env, body) {
  await requireAdmin(request, env);
  const ids = Array.isArray(body?.ids) ? body.ids : [];
  if (!ids.length) {
    return jsonResponse(request, { ok: false, error: 'No ids provided' }, { status: 400 });
  }

  const db = getDb(env);
  await ensureInboxTable(db);

  let updated = 0;
  for (const id of ids) {
    const result = await db.prepare('UPDATE inbox SET status = ? WHERE recipe_id = ?').bind('imported', id).run();
    if (result.meta?.changes > 0) updated += 1;
  }

  return jsonResponse(request, { ok: true, updated });
}

async function adminPurgeImported(request, env, body) {
  await requireAdmin(request, env);
  const ids = Array.isArray(body?.ids) ? body.ids : [];
  if (!ids.length) {
    return jsonResponse(request, { ok: false, error: 'No ids provided' }, { status: 400 });
  }

  const db = getDb(env);
  await ensureInboxTable(db);

  let removed = 0;
  for (const id of ids) {
    const result = await db.prepare('DELETE FROM inbox WHERE recipe_id = ?').bind(id).run();
    if (result.meta?.changes > 0) removed += 1;
  }

  return jsonResponse(request, { ok: true, removed });
}

async function adminWipe(request, env) {
  await requireAdmin(request, env);
  const db = getDb(env);
  await ensureInboxTable(db);
  const result = await db.prepare('DELETE FROM inbox').run();
  return jsonResponse(request, { ok: true, removed: result.meta?.changes || 0 });
}

const ROUTES = {
  '/api/add': familySubmit,
  '/api/list': listSubmissions,
  '/admin/export': adminExport,
  '/admin/mark-imported': adminMarkImported,
  '/admin/purge-imported': adminPurgeImported,
  '/admin/wipe': adminWipe,
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return textResponse(request, null, { status: 204 });
    }

    if (request.method === 'GET') {
      return jsonResponse(request, { ok: true });
    }

    if (request.method !== 'POST') {
      return textResponse(request, 'Not found', { status: 404 });
    }

    const url = new URL(request.url);
    const handler = ROUTES[url.pathname];
    if (!handler) {
      return textResponse(request, 'Not found', { status: 404 });
    }

    let body;
    try {
      body = await parseJson(request);
    } catch (err) {
      return jsonResponse(request, { ok: false, error: err.message }, { status: 400 });
    }

    try {
      return await handler(request, env, body);
    } catch (err) {
      const message = err?.message || 'Unexpected error';
      const status = message.toLowerCase().includes('token') || message.toLowerCase().includes('password') ? 401 : 500;
      return jsonResponse(request, { ok: false, error: message }, { status });
    }
  },
};

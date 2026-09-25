// Cloudflare Worker inbox API
// Env bindings: DB (D1), FAMILY_PASSWORD or RECIPE_PASSWORD, ADMIN_TOKEN
// Schema lives in cloudflare/schema.sql and is applied automatically on first use.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Recipe-Password, X-Admin-Token',
};

function withCors(headers = {}) {
  return { ...CORS_HEADERS, ...headers };
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: withCors({ 'Content-Type': 'application/json', ...headers }),
  });
}

function textResponse(body, status = 200, headers = {}) {
  return new Response(body, { status, headers: withCors(headers) });
}

function slugify(text) {
  return (text || '')
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getFamilyPassword(env) {
  return env?.FAMILY_PASSWORD || env?.RECIPE_PASSWORD || '';
}

function getAdminToken(env) {
  return env?.ADMIN_TOKEN || '';
}

function requireFamilyPassword(request, env) {
  const expected = getFamilyPassword(env);
  if (!expected) {
    throw new Error('Family password not configured');
  }
  const provided = request.headers.get('X-Recipe-Password');
  if (!provided || provided !== expected) {
    throw new Error('Invalid family password');
  }
}

function requireAdminToken(request, env) {
  const expected = getAdminToken(env);
  if (!expected) {
    throw new Error('Admin token not configured');
  }
  const provided = request.headers.get('X-Admin-Token');
  if (!provided || provided !== expected) {
    throw new Error('Invalid admin token');
  }
}

function getDb(env) {
  const db = env?.DB;
  if (!db?.prepare) {
    throw new Error('D1 database binding "DB" is missing');
  }
  return db;
}

async function ensureSchema(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS recipes_inbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        slug TEXT,
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`
    )
    .run();

  await db
    .prepare('CREATE INDEX IF NOT EXISTS idx_recipes_inbox_status ON recipes_inbox (status)')
    .run();
  await db
    .prepare('CREATE INDEX IF NOT EXISTS idx_recipes_inbox_created_at ON recipes_inbox (created_at)')
    .run();
}

async function parseJson(request) {
  try {
    return await request.json();
  } catch (err) {
    throw new Error('Invalid JSON payload');
  }
}

function normalizeStatus(input) {
  const allowed = ['pending', 'all'];
  if (allowed.includes(input)) return input;
  return 'pending';
}

function mapRow(row, includePayload) {
  const base = {
    id: row.id,
    recipe_id: row.slug || row.id,
    title: row.title,
    slug: row.slug,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };

  if (!includePayload) return base;

  try {
    const payload = JSON.parse(row.payload || '{}');
    return { ...base, payload };
  } catch (err) {
    return base;
  }
}

async function handleHealth(request, env) {
  const response = { ok: true };
  const db = env?.DB;
  if (db?.prepare) {
    try {
      await ensureSchema(db);
      const row = await db.prepare('SELECT COUNT(*) AS count FROM recipes_inbox').first();
      response.db = { ok: true, count: row?.count ?? 0 };
    } catch (err) {
      response.db = { ok: false, error: err.message };
    }
  }
  return jsonResponse(response);
}

async function handleAdd(request, env, body) {
  requireFamilyPassword(request, env);
  const db = getDb(env);
  await ensureSchema(db);

  const payload = body?.payload;
  const title = body?.title || payload?.title;

  if (!title || typeof title !== 'string') {
    return jsonResponse({ ok: false, error: 'Missing recipe title' }, 400);
  }
  if (!payload || typeof payload !== 'object') {
    return jsonResponse({ ok: false, error: 'Missing recipe payload' }, 400);
  }

  const slug = slugify(body?.slug || payload.slug || title);
  const now = new Date().toISOString();
  const recordPayload = {
    ...payload,
    title: payload.title || title,
    slug: payload.slug || slug,
  };

  const recipeId = recordPayload.id || recordPayload.recipe_id || slug;
  recordPayload.id = recordPayload.id || recipeId;
  recordPayload.recipe_id = recordPayload.recipe_id || recipeId;

  const insert = await db
    .prepare(
      'INSERT INTO recipes_inbox (title, slug, payload, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .bind(title, slug, JSON.stringify(recordPayload), 'pending', now, now)
    .run();

  return jsonResponse({ ok: true, id: insert.meta.last_row_id, slug, status: 'pending' });
}

async function listSubmissions(request, env, body, { requireFamily } = { requireFamily: true }) {
  if (requireFamily) {
    requireFamilyPassword(request, env);
  }
  const db = getDb(env);
  await ensureSchema(db);

  const status = normalizeStatus(body?.status);
  const includePayload = Boolean(body?.include_payload || body?.includePayload);

  const selectFields = [
    'id',
    'title',
    'slug',
    'status',
    'created_at',
    'updated_at',
    includePayload ? 'payload' : null,
  ]
    .filter(Boolean)
    .join(', ');

  let sql = `SELECT ${selectFields} FROM recipes_inbox`;
  const params = [];
  if (status !== 'all') {
    sql += ' WHERE status = ?';
    params.push(status);
  }
  sql += ' ORDER BY created_at DESC, id DESC';

  const rows = await db.prepare(sql).bind(...params).all();
  const items = (rows.results || []).map((row) => mapRow(row, includePayload));

  return jsonResponse({ ok: true, items, status });
}

async function adminExport(request, env, body) {
  requireAdminToken(request, env);
  return listSubmissions(request, env, body, { requireFamily: false });
}

async function adminUpdatePending(request, env, body) {
  requireAdminToken(request, env);

  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonResponse({ ok: false, error: 'A valid pending recipe id is required' }, 400);
  }

  const payload = body?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return jsonResponse({ ok: false, error: 'Missing recipe payload' }, 400);
  }

  const expectedUpdatedAt = String(body?.expected_updated_at || '').trim();
  if (!expectedUpdatedAt) {
    return jsonResponse(
      {
        ok: false,
        error: 'Reload this pending recipe before saving so the current version can be verified.',
      },
      409
    );
  }

  const title = String(payload.title || '').trim();
  if (!title) {
    return jsonResponse({ ok: false, error: 'Recipe title is required' }, 400);
  }

  const recipeId = String(payload.id || payload.recipe_id || slugify(title)).trim();
  if (!recipeId) {
    return jsonResponse({ ok: false, error: 'Recipe id is required' }, 400);
  }

  const db = getDb(env);
  await ensureSchema(db);

  const slug = slugify(payload.slug || recipeId || title);
  const now = new Date().toISOString();
  const recordPayload = {
    ...payload,
    id: recipeId,
    recipe_id: recipeId,
    title,
    slug,
  };

  const update = await db
    .prepare(
      "UPDATE recipes_inbox SET title = ?, slug = ?, payload = ?, updated_at = ? WHERE id = ? AND status = 'pending' AND updated_at = ?"
    )
    .bind(title, slug, JSON.stringify(recordPayload), now, id, expectedUpdatedAt)
    .run();

  const changed = Number(update?.meta?.changes ?? 0);
  if (changed !== 1) {
    const current = await db
      .prepare('SELECT id, status, updated_at FROM recipes_inbox WHERE id = ?')
      .bind(id)
      .first();

    if (!current || current.status !== 'pending') {
      return jsonResponse({ ok: false, error: 'Pending recipe not found' }, 404);
    }

    return jsonResponse(
      {
        ok: false,
        error: 'This pending recipe changed after you opened it. Reload it before saving so newer changes are not overwritten.',
        current_updated_at: current.updated_at,
      },
      409
    );
  }

  const updated = await db
    .prepare(
      'SELECT id, title, slug, payload, status, created_at, updated_at FROM recipes_inbox WHERE id = ?'
    )
    .bind(id)
    .first();

  return jsonResponse({ ok: true, item: mapRow(updated, true) });
}

function normalizeDeleteSnapshots(body) {
  if (!Array.isArray(body?.items)) return [];
  return body.items
    .map((item) => ({
      id: Number(item?.id),
      updatedAt: String(item?.updated_at || item?.updatedAt || '').trim(),
    }))
    .filter((item) => Number.isInteger(item.id) && item.id > 0 && item.updatedAt);
}

async function adminDeletePending(request, env, body) {
  requireAdminToken(request, env);

  const db = getDb(env);
  await ensureSchema(db);

  const snapshots = normalizeDeleteSnapshots(body);
  const requestedItems = Array.isArray(body?.items) ? body.items.length : 0;

  if (requestedItems > 0 && snapshots.length !== requestedItems) {
    return jsonResponse(
      { ok: false, error: 'Every version-aware delete item must include a valid id and updated_at value.' },
      400
    );
  }

  if (snapshots.length > 0) {
    let deleted = 0;
    const conflicts = [];

    for (const snapshot of snapshots) {
      const result = await db
        .prepare(
          "DELETE FROM recipes_inbox WHERE status = 'pending' AND id = ? AND updated_at = ?"
        )
        .bind(snapshot.id, snapshot.updatedAt)
        .run();

      const changes = Number(result?.meta?.changes ?? 0);
      deleted += changes;
      if (changes !== 1) conflicts.push(snapshot.id);
    }

    if (conflicts.length) {
      return jsonResponse(
        {
          ok: false,
          error: 'Some pending recipes changed after the publish snapshot and were left in the inbox.',
          deleted,
          conflicts,
        },
        409
      );
    }

    return jsonResponse({ ok: true, deleted });
  }

  const ids = Array.isArray(body?.ids)
    ? body.ids.map(Number).filter((id) => Number.isInteger(id) && id > 0)
    : [];

  let result;
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    result = await db
      .prepare(`DELETE FROM recipes_inbox WHERE status = 'pending' AND id IN (${placeholders})`)
      .bind(...ids)
      .run();
  } else {
    result = await db.prepare("DELETE FROM recipes_inbox WHERE status = 'pending'").run();
  }

  const deleted = typeof result?.meta?.changes === 'number' ? result.meta.changes : undefined;
  const response = { ok: true };
  if (typeof deleted === 'number') {
    response.deleted = deleted;
  } else {
    response.attempted = ids.length;
  }

  return jsonResponse(response);
}

const ROUTES = {
  'GET:/health': handleHealth,
  'POST:/health': handleHealth,
  'POST:/api/add': handleAdd,
  'POST:/api/list': listSubmissions,
  'POST:/admin/export': adminExport,
  'POST:/admin/update-pending': adminUpdatePending,
  'POST:/admin/delete-pending': adminDeletePending,
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return textResponse('', 204);
    }

    const url = new URL(request.url);
    const key = `${request.method}:${url.pathname}`;
    const handler = ROUTES[key];

    if (!handler) {
      return textResponse('Not found', 404);
    }

    try {
      const body = request.method === 'POST' ? await parseJson(request) : null;
      return await handler(request, env, body);
    } catch (err) {
      const message = err?.message || 'Unexpected error';
      const status = message.toLowerCase().includes('password') || message.toLowerCase().includes('token') ? 401 : 500;
      return jsonResponse({ ok: false, error: message }, status);
    }
  },
};

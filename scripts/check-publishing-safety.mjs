import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const workerPath = process.env.WORKER_PATH || new URL('../cloudflare/worker.js', import.meta.url);
const workerSource = fs.readFileSync(workerPath, 'utf8');
assert.match(
  workerSource,
  /UPDATE recipes_inbox[\s\S]*WHERE id = \? AND status = 'pending' AND updated_at = \?/,
  'admin update must compare updated_at in the UPDATE itself'
);
assert.match(
  workerSource,
  /DELETE FROM recipes_inbox WHERE status = 'pending' AND id = \? AND updated_at = \?/,
  'publication cleanup must delete only the exported row version'
);

const workflowPath = process.env.PUBLISH_WORKFLOW_PATH || new URL('../.github/workflows/publish-recipes.yml', import.meta.url);
const workflowSource = fs.readFileSync(workflowPath, 'utf8');
assert.doesNotMatch(
  workflowSource,
  /scripts\/import-inbox\.mjs[\s\S]{0,300}--dry-run/,
  'workflow dry-run must materialize proposed recipe files in the disposable runner'
);
assert.match(
  workflowSource,
  /Wait for Pages to deploy the exact published commit/,
  'publishing must wait for the exact Pages deployment'
);
assert.match(
  workflowSource,
  /JSON\.stringify\(\{ items \}\)/,
  'cleanup payload must contain exported row versions, not bare ids'
);
assert.ok(
  workflowSource.indexOf('Wait for Pages to deploy the exact published commit') <
    workflowSource.indexOf('Remove only the published row versions from the inbox'),
  'deployment confirmation must occur before inbox cleanup'
);

const workerUrl = workerPath instanceof URL ? workerPath : pathToFileURL(workerPath);
const worker = (await import(workerUrl.href)).default;

class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql.replace(/\s+/g, ' ').trim();
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  async run() {
    const sql = this.sql;
    if (sql.startsWith('CREATE TABLE') || sql.startsWith('CREATE INDEX')) {
      return { meta: { changes: 0 } };
    }

    if (sql.startsWith('UPDATE recipes_inbox')) {
      const [title, slug, payload, updatedAt, id, expectedUpdatedAt] = this.args;
      const row = this.db.rows.get(Number(id));
      if (!row || row.status !== 'pending' || row.updated_at !== expectedUpdatedAt) {
        return { meta: { changes: 0 } };
      }
      this.db.rows.set(Number(id), {
        ...row,
        title,
        slug,
        payload,
        updated_at: updatedAt,
      });
      return { meta: { changes: 1 } };
    }

    if (sql === "DELETE FROM recipes_inbox WHERE status = 'pending' AND id = ? AND updated_at = ?") {
      const [id, expectedUpdatedAt] = this.args;
      const row = this.db.rows.get(Number(id));
      if (!row || row.status !== 'pending' || row.updated_at !== expectedUpdatedAt) {
        return { meta: { changes: 0 } };
      }
      this.db.rows.delete(Number(id));
      return { meta: { changes: 1 } };
    }

    if (sql.startsWith("DELETE FROM recipes_inbox WHERE status = 'pending' AND id IN")) {
      let changes = 0;
      for (const rawId of this.args) {
        const id = Number(rawId);
        const row = this.db.rows.get(id);
        if (row?.status === 'pending') {
          this.db.rows.delete(id);
          changes += 1;
        }
      }
      return { meta: { changes } };
    }

    if (sql === "DELETE FROM recipes_inbox WHERE status = 'pending'") {
      let changes = 0;
      for (const [id, row] of [...this.db.rows]) {
        if (row.status === 'pending') {
          this.db.rows.delete(id);
          changes += 1;
        }
      }
      return { meta: { changes } };
    }

    throw new Error(`Unhandled run SQL: ${sql}`);
  }

  async first() {
    const id = Number(this.args[0]);
    const row = this.db.rows.get(id);
    if (!row) return null;

    if (this.sql === 'SELECT id, status, updated_at FROM recipes_inbox WHERE id = ?') {
      return { id: row.id, status: row.status, updated_at: row.updated_at };
    }
    if (this.sql === 'SELECT id, title, slug, payload, status, created_at, updated_at FROM recipes_inbox WHERE id = ?') {
      return { ...row };
    }
    if (this.sql === 'SELECT COUNT(*) AS count FROM recipes_inbox') {
      return { count: this.db.rows.size };
    }
    throw new Error(`Unhandled first SQL: ${this.sql}`);
  }

  async all() {
    throw new Error(`Unhandled all SQL: ${this.sql}`);
  }
}

class FakeDb {
  constructor(rows) {
    this.rows = new Map(rows.map((row) => [row.id, { ...row }]));
  }
  prepare(sql) {
    return new FakeStatement(this, sql);
  }
}

function request(path, body) {
  return new Request(`https://worker.test${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Token': 'admin-test-token',
    },
    body: JSON.stringify(body),
  });
}

const originalTimestamp = '2026-09-22T20:00:00.000Z';
const baseRow = {
  id: 1,
  title: 'Original',
  slug: 'original',
  payload: JSON.stringify({ id: 'original', title: 'Original' }),
  status: 'pending',
  created_at: originalTimestamp,
  updated_at: originalTimestamp,
};

{
  const db = new FakeDb([baseRow]);
  const env = { DB: db, ADMIN_TOKEN: 'admin-test-token' };

  const first = await worker.fetch(
    request('/admin/update-pending', {
      id: 1,
      expected_updated_at: originalTimestamp,
      payload: { id: 'original', title: 'First edit' },
    }),
    env
  );
  assert.equal(first.status, 200, 'first edit should succeed');

  const stale = await worker.fetch(
    request('/admin/update-pending', {
      id: 1,
      expected_updated_at: originalTimestamp,
      payload: { id: 'original', title: 'Stale edit' },
    }),
    env
  );
  assert.equal(stale.status, 409, 'stale edit must be rejected');
  const current = JSON.parse(db.rows.get(1).payload);
  assert.equal(current.title, 'First edit', 'stale edit must not overwrite newer content');
}

{
  const db = new FakeDb([{ ...baseRow, updated_at: '2026-09-22T20:05:00.000Z' }]);
  const env = { DB: db, ADMIN_TOKEN: 'admin-test-token' };
  const cleanup = await worker.fetch(
    request('/admin/delete-pending', {
      items: [{ id: 1, updated_at: originalTimestamp }],
    }),
    env
  );
  assert.equal(cleanup.status, 409, 'cleanup of an edited row must fail safely');
  assert.ok(db.rows.has(1), 'a row edited after export must remain in the inbox');
}

{
  const db = new FakeDb([baseRow]);
  const env = { DB: db, ADMIN_TOKEN: 'admin-test-token' };
  const cleanup = await worker.fetch(
    request('/admin/delete-pending', {
      items: [{ id: 1, updated_at: originalTimestamp }],
    }),
    env
  );
  assert.equal(cleanup.status, 200, 'cleanup of the exact published version should succeed');
  assert.equal(db.rows.has(1), false, 'published row should be removed after exact-version cleanup');
}

console.log('Publishing safety tests passed.');

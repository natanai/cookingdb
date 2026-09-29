import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import worker from '../../cloudflare/worker.js';

// Runs production Worker handlers and their SQL against a disposable SQLite DB.
// Only the D1 transport adapter is substituted. No live credentials or data.
export function createSQLiteWorker() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cookingdb-sqlite-'));
  const database = path.join(directory, 'inbox.sqlite');
  const execute = (sql, params, mode) => JSON.parse(execFileSync('python3', ['-c', `
import json, sqlite3, sys
request = json.load(sys.stdin)
with sqlite3.connect(sys.argv[1]) as db:
    db.row_factory = sqlite3.Row
    cursor = db.execute(request['sql'], request['params'])
    if request['mode'] == 'first':
        row = cursor.fetchone()
        result = dict(row) if row else None
    elif request['mode'] == 'all':
        result = {'results': [dict(row) for row in cursor.fetchall()]}
    else:
        result = {'success': True, 'meta': {'changes': max(cursor.rowcount, 0), 'last_row_id': cursor.lastrowid}}
    print(json.dumps(result))
`, database], { input: JSON.stringify({sql, params, mode}), encoding: 'utf8' }));
  const DB = {
    prepare(sql) {
      let params = [];
      return {
        bind(...values) { params = values; return this; },
        async run() { return execute(sql, params, 'run'); },
        async all() { return execute(sql, params, 'all'); },
        async first() { return execute(sql, params, 'first'); },
      };
    },
  };
  const env = {DB, FAMILY_PASSWORD:'browser-family-password', ADMIN_TOKEN:'browser-admin-token'};
  return {
    env,
    fetch: request => worker.fetch(request, env),
    get items() {
      return execute('SELECT * FROM recipes_inbox ORDER BY id', [], 'all').results
        .map(row => ({...row, payload: JSON.parse(row.payload)}));
    },
    close() { fs.rmSync(directory, {recursive:true, force:true}); },
  };
}

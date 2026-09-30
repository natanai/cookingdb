import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function makeReceipt(report, exported, sourceSha) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha || '')) throw new Error('An exact publication commit is required.');
  const ids = report.inbox_ids;
  if (!Array.isArray(ids) || ids.length !== report.processed || new Set(ids).size !== ids.length ||
      ids.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error('Every imported recipe must have one unique numeric inbox ID.');
  }
  const rows = exported.items || exported.pending;
  if (!Array.isArray(rows)) throw new Error('Inbox export has no row list.');
  const items = ids.map(id => {
    const matches = rows.filter(row => row.id === id);
    if (matches.length !== 1 || matches[0].status !== 'pending' ||
        typeof matches[0].updated_at !== 'string' || !Number.isFinite(Date.parse(matches[0].updated_at))) {
      throw new Error(`Inbox row ${id} has no unique pending version. Cleanup stopped safely.`);
    }
    return { id, updated_at: matches[0].updated_at };
  });
  return { version: 1, source_sha: sourceSha, items };
}

export async function preflight(baseUrl, fetcher = fetch) {
  const response = await fetcher(`${baseUrl.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Worker health check failed (${response.status}).`);
  const health = await response.json();
  if (!health.ok || !health.db?.ok || !health.capabilities?.includes('acknowledge-published-v1')) {
    throw new Error('Deploy the current cloudflare/worker.js with its D1 binding before publishing. Inbox rows were retained.');
  }
}

export async function acknowledge(receipt, sourceSha, baseUrl, token, fetcher = fetch) {
  if (receipt.version !== 1 || receipt.source_sha !== sourceSha || !receipt.items?.length) {
    throw new Error('Receipt does not match the successfully deployed commit.');
  }
  // Validate downloaded receipts too, before any network mutation.
  makeReceipt({ processed: receipt.items.length, inbox_ids: receipt.items.map(item => item.id) },
    { items: receipt.items.map(item => ({ ...item, status: 'pending' })) }, sourceSha);
  if (!token) throw new Error('Admin token is required.');
  await preflight(baseUrl, fetcher);
  // A distinct route is intentional: an older Worker responds 404 rather than
  // interpreting an unfamiliar selector as its legacy "delete all" request.
  const response = await fetcher(`${baseUrl.replace(/\/$/, '')}/admin/acknowledge-published`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
    body: JSON.stringify({ items: receipt.items }),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`Inbox acknowledgement failed (${response.status}); inspect retained row versions before retrying.`);
  const result = await response.json();
  if (!result.ok || result.deleted !== receipt.items.length) throw new Error('Inbox acknowledgement was incomplete.');
  return result;
}

async function main() {
  const baseUrl = process.env.COOKINGDB_INBOX_URL;
  const tempDir = process.env.RUNNER_TEMP;
  const read = name => JSON.parse(fs.readFileSync(path.join(tempDir, name), 'utf8'));
  switch (process.argv[2]) {
    case 'preflight':
      await preflight(baseUrl);
      break;
    case 'receipt': {
      const receipt = makeReceipt(read('cookingdb-import-report.json'), read('cookingdb-inbox.json'), process.env.PUBLISHED_SHA);
      fs.writeFileSync(path.join(tempDir, 'publication-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
      break;
    }
    case 'acknowledge': {
      const result = await acknowledge(read('publication-receipt.json'), process.env.PUBLISHED_SHA, baseUrl, process.env.COOKINGDB_ADMIN_TOKEN);
      console.log(`Removed ${result.deleted} exact-version pending rows after successful deployment.`);
      break;
    }
    default: throw new Error('Usage: node scripts/publish-inbox.mjs preflight|receipt|acknowledge');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

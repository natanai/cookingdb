import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { fetchBuiltJson } from './built-data.js';

// Exercise native fetch cancellation against actual stalled headers and bodies.
const counts = new Map();
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const count = (counts.get(pathname) || 0) + 1;
  counts.set(pathname, count);
  if (pathname.endsWith('/headers.json')) return;
  if (pathname.endsWith('/body.json')) {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.write('{"unfinished":');
    return;
  }
  response.setHeader('Content-Type', 'application/json');
  if (pathname.endsWith('/retry.json') && count === 1) response.end('invalid json');
  else response.end('{"ready":true}');
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const nativeFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = (url, options) => {
  calls.push({ url, cache: options.cache, signal: options.signal });
  return nativeFetch(new URL(url, `http://127.0.0.1:${server.address().port}/`), options);
};

try {
  for (const file of ['headers.json', 'body.json']) {
    calls.length = 0;
    await assert.rejects(fetchBuiltJson(file, { label: 'Catalog', timeoutMs: 100 }), /Catalog timed out/);
    assert.deepEqual(calls.map(call => call.cache), ['default', 'reload']);
    assert.ok(calls.every(call => call.signal.aborted));
  }
  calls.length = 0;
  assert.deepEqual(await fetchBuiltJson('retry.json'), { ready: true });
  assert.deepEqual(calls.map(call => call.cache), ['default', 'reload']);
  assert.equal(calls[0].url, calls[1].url, 'retry must preserve the versioned URL');
  assert.match(calls[0].url, /\?v=/);
  assert.ok(calls.every(call => !call.signal.aborted));
  await assert.rejects(fetchBuiltJson('ready.json', { timeoutMs: 0 }), /positive/);
  assert.deepEqual(await fetchBuiltJson('ready.json'), { ready: true }, 'a later request must remain usable after timeouts');
} finally {
  globalThis.fetch = nativeFetch;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
console.log('Built-data tests passed: stalled headers/body abort, versioned retry, and recovery.');

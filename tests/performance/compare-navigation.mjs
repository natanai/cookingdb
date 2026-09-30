import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { chromium, webkit, devices } from '@playwright/test';
import { userClick } from '../browser/journey-helpers.mjs';

const candidateRoot = process.cwd();
const baselineRoot = path.resolve(process.env.BASELINE_ROOT || '');
if (!process.env.BASELINE_ROOT || baselineRoot === candidateRoot) throw new Error('BASELINE_ROOT must point to a separately built main checkout.');
const output = path.resolve('navigation-report');
fs.mkdirSync(output, { recursive: true });
const recipeId = 'apple-cider-brisket';
const rounds = 3;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const revision = root => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

// Snapshot the site's real Google font assets once, then serve exactly those
// bytes to both builds. No Playwright routing: it would disable HTTP caching.
async function snapshotFonts() {
  const imports = [candidateRoot, baselineRoot].map(root =>
    fs.readFileSync(path.join(root, 'docs/styles.css'), 'utf8').match(/@import url\(['"]?(https:[^'")]+)['"]?\);/)?.[1]);
  if (!imports[0] || imports[0] !== imports[1]) throw new Error('Font imports differ; review the font comparison fixture.');
  const response = await fetch(imports[0], { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Font fixture download failed: ${response.status}`);
  let css = await response.text();
  const assets = new Map();
  const urls = [...new Set([...css.matchAll(/url\((https:\/\/[^)]+)\)/g)].map(match => match[1]))];
  if (!urls.length) throw new Error('Font stylesheet contained no downloadable assets.');
  for (const [index, url] of urls.entries()) {
    if (new URL(url).hostname !== 'fonts.gstatic.com') throw new Error('Unexpected font asset host.');
    const font = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!font.ok) throw new Error(`Font asset download failed: ${font.status}`);
    const local = `/__benchmark_fonts/${index}${path.extname(new URL(url).pathname)}`;
    assets.set(local, { body: Buffer.from(await font.arrayBuffer()), type: font.headers.get('content-type') || 'font/woff2' });
    css = css.replaceAll(url, local);
  }
  assets.set('/__benchmark_fonts/fonts.css', { body: Buffer.from(css), type: 'text/css' });
  return { assets, originalImport: imports[0] };
}

async function serve(root, latencyMs, fonts) {
  const docs = path.join(root, 'docs');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml' };
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      let asset = fonts.assets.get(pathname);
      if (!asset) {
        const file = path.resolve(docs, `.${pathname === '/' ? '/index.html' : pathname}`);
        if (!file.startsWith(`${docs}${path.sep}`)) { response.writeHead(403).end(); return; }
        let body = fs.readFileSync(file);
        if (pathname === '/styles.css') body = Buffer.from(body.toString().replace(fonts.originalImport, '/__benchmark_fonts/fonts.css'));
        asset = { body, type: types[path.extname(file)] || 'application/octet-stream' };
      }
      await sleep(latencyMs);
      response.writeHead(200, { 'Content-Type': asset.type, 'Cache-Control': 'public, max-age=3600', 'Content-Length': asset.body.length });
      response.end(asset.body);
    } catch {
      response.writeHead(404).end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { url: `http://127.0.0.1:${server.address().port}`, close: async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  } };
}

async function measure(browser, device, url, warm, screenshotPath) {
  const context = await browser.newContext({ ...device, serviceWorkers: 'block' });
  try {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      document.addEventListener('click', event => {
        const link = event.target.closest?.('a[href*="recipe.html?"]');
        if (link) sessionStorage.setItem('__benchmarkClick', String(Date.now()));
      }, true);
      const state = { readyMs: null, changes: 0, samples: 0, done: false };
      window.__navigationMeasurement = state;
      let previous = null;
      let revealedAt;
      function sample() {
        const selectors = ['#recipe-title', '#ingredients-list', '#steps-list'];
        const elements = selectors.map(selector => document.querySelector(selector));
        if (elements.every(Boolean) && elements[1].children.length && elements[2].children.length &&
            !document.body.classList.contains('recipe-is-loading') && elements.every(el => el.getBoundingClientRect().height > 0)) {
          if (revealedAt === undefined) {
            revealedAt = performance.now();
            state.readyMs = Date.now() - Number(sessionStorage.getItem('__benchmarkClick'));
          }
          const signature = JSON.stringify(elements.map(el => {
            const rect = el.getBoundingClientRect();
            return { text: el.innerText, box: [rect.x, rect.y, rect.width, rect.height].map(value => Math.round(value)) };
          }));
          if (previous !== null && signature !== previous) state.changes++;
          previous = signature;
          state.samples++;
          if (performance.now() - revealedAt >= 1000) { state.done = true; return; }
        }
        requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    });
    await page.goto(`${url}/index.html`, { waitUntil: 'domcontentloaded' });
    if (warm) await page.waitForLoadState('networkidle');
    const link = page.locator(`#recipe-list a[href="recipe.html?id=${recipeId}"]`);
    await userClick(link, 'benchmark cookbook recipe');
    await page.waitForURL(/\/recipe\.html\?id=/);
    await page.waitForFunction(() => window.__navigationMeasurement?.done, null, { timeout: 15000 });
    const result = await page.evaluate(() => window.__navigationMeasurement);
    if (errors.length) throw new Error(`Page errors: ${errors.join('; ')}`);
    if (!Number.isFinite(result.readyMs) || result.readyMs < 0 || result.samples < 2) throw new Error('Invalid navigation measurement.');
    if (screenshotPath) await page.screenshot({ path: screenshotPath, fullPage: true });
    return result;
  } finally {
    await context.close();
  }
}

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const report = {
  candidate: process.env.CANDIDATE_SHA || revision(candidateRoot),
  checkout: revision(candidateRoot), baseline: revision(baselineRoot), recipeId, rounds,
  method: 'Fresh browser contexts; alternating paired order; 0/80 ms server response latency; real font snapshot shared by both builds; no bandwidth or CPU throttling. Immediate click vs network-idle preload. One second of post-reveal text/geometry sampling.',
  tolerance: 'Candidate median <= baseline median * 1.20 + 100 ms; no more post-reveal changes than baseline. Three samples are a regression screen, not a statistical performance guarantee.',
  comparisons: [],
};
try {
  const fonts = await snapshotFonts();
  for (const [engineName, engine, device] of [
    ['desktop-chromium', chromium, devices['Desktop Chrome']],
    ['mobile-webkit', webkit, devices['iPhone 13']],
  ]) {
    const browser = await engine.launch();
    try {
      for (const latencyMs of [0, 80]) {
        const servers = { main: await serve(baselineRoot, latencyMs, fonts), candidate: await serve(candidateRoot, latencyMs, fonts) };
        try {
          for (const warm of [false, true]) {
            const name = `${engineName}-${latencyMs}ms-${warm ? 'warm' : 'immediate'}`;
            const samples = { main: [], candidate: [] };
            for (let round = 0; round < rounds; round++) {
              for (const side of round % 2 ? ['candidate', 'main'] : ['main', 'candidate']) {
                samples[side].push(await measure(browser, device, servers[side].url, warm,
                  round === 0 ? path.join(output, `${name}-${side}.png`) : null));
              }
            }
            const mainMs = median(samples.main.map(sample => sample.readyMs));
            const candidateMs = median(samples.candidate.map(sample => sample.readyMs));
            const mainChanges = Math.max(...samples.main.map(sample => sample.changes));
            const candidateChanges = Math.max(...samples.candidate.map(sample => sample.changes));
            const passed = candidateMs <= mainMs * 1.2 + 100 && candidateChanges <= mainChanges;
            report.comparisons.push({ name, mainMs, candidateMs, mainChanges, candidateChanges, passed, samples });
            console.log(`${name}: main=${mainMs}ms candidate=${candidateMs}ms; post-reveal changes ${mainChanges}/${candidateChanges}; ${passed ? 'PASS' : 'REGRESSION'}`);
          }
        } finally { await servers.main.close(); await servers.candidate.close(); }
      }
    } finally { await browser.close(); }
  }
  if (report.comparisons.some(item => !item.passed)) process.exitCode = 1;
} catch (error) {
  report.error = error.stack;
  process.exitCode = 1;
  console.error(error);
} finally {
  fs.writeFileSync(path.join(output, 'comparison.json'), `${JSON.stringify(report, null, 2)}\n`);
  const rows = report.comparisons.map(item => `| ${item.name} | ${item.mainMs} | ${item.candidateMs} | ${item.mainChanges} / ${item.candidateChanges} | ${item.passed ? 'Pass' : 'Investigate'} |`);
  fs.writeFileSync(path.join(output, 'comparison.md'), `# Navigation comparison\n\nBaseline: ${report.baseline}\n\nCandidate: ${report.candidate}\n\n${report.method}\n\n${report.tolerance}\n\n| Scenario | Main median ms | Candidate median ms | Post-reveal changes main / candidate | Result |\n|---|---:|---:|---:|---|\n${rows.join('\n')}\n${report.error ? `\nMeasurement failed: ${report.error}\n` : ''}`);
}

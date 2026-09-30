import fs from 'node:fs';
import path from 'node:path';

const docsDir = path.resolve(process.cwd(), 'docs');
const pages = ['index.html', 'recipe.html', 'add.html', 'planner.html', 'bread-maker.html', 'admin.html'];

function fail(message) {
  console.error(`Header DOM contract failed: ${message}`);
  process.exitCode = 1;
}

for (const page of pages) {
  const html = fs.readFileSync(path.join(docsDir, page), 'utf8');
  const header = html.match(/<header\b[^>]*class=["'][^"']*\bsite-header\b[^"']*["'][^>]*>([\s\S]*?)<\/header>/i);
  if (!header) {
    fail(`${page} is missing the shared site header.`);
    continue;
  }

  const inner = header[1].match(/<div\b[^>]*class=["'][^"']*\binner\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (!inner) {
    fail(`${page} site header is missing its inner container.`);
    continue;
  }

  if (/\bsite-title\b/.test(inner[1])) {
    fail(`${page} still carries a hidden or redundant site-title element. Remove obsolete header UI from the DOM instead of hiding it.`);
  }

  const withoutManagedNav = inner[1]
    .replace(/<nav\b[^>]*\bdata-site-nav\b[^>]*>[\s\S]*?<\/nav>/i, '')
    .trim();

  if (withoutManagedNav) {
    fail(`${page} site header contains markup outside the shared managed navigation. Active page content belongs in the page document, not dormant in the app bar.`);
  }
}

if (!process.exitCode) {
  console.log(`Header DOM contract OK (${pages.length} pages): app bars contain only the shared managed navigation.`);
}

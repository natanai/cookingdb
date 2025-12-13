#!/usr/bin/env node
import http from 'http';
import fs from 'fs';
import path from 'path';

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

function parseArgs() {
  const args = process.argv.slice(2);
  let root = process.cwd();
  let cacheControl = 'public, max-age=0';
  let port = 8080;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-p' && args[i + 1]) {
      port = Number(args[i + 1]);
      i++;
    } else if (arg.startsWith('-c')) {
      if (arg === '-c-1') {
        cacheControl = 'no-store';
      }
    } else if (!arg.startsWith('-')) {
      root = path.resolve(process.cwd(), arg);
    }
  }

  return { root, port, cacheControl };
}

function serveFile(filePath, cacheControl, res) {
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    const stream = fs.createReadStream(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': cacheControl
    });
    stream.pipe(res);
  });
}

function startServer({ root, port, cacheControl }) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let filePath = path.join(root, urlPath);

    fs.stat(filePath, (err, stats) => {
      if (!err && stats.isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }
      serveFile(filePath, cacheControl, res);
    });
  });

  server.listen(port, () => {
    console.log(`Serving ${root} at http://localhost:${port}`);
  });
}

const args = parseArgs();
startServer(args);

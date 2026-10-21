import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('./dist', import.meta.url)));
const port = Number(process.env.PORT || 8080);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2' };

createServer((request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end('Method not allowed'); return; }
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname); }
  catch { response.writeHead(400).end('Bad request'); return; }
  const file = resolve(root, `.${pathname}`);
  if (file !== root && !file.startsWith(`${root}${sep}`)) { response.writeHead(403).end('Forbidden'); return; }

  let target = file;
  let info;
  try {
    info = statSync(target);
    if (info.isDirectory()) { target = resolve(target, 'index.html'); info = statSync(target); }
  } catch {
    const assetRequest = extname(pathname) !== '' || pathname.startsWith('/_expo/') || pathname.startsWith('/assets/');
    if (assetRequest) { response.writeHead(404).end('Not found'); return; }
    target = resolve(root, 'index.html');
    try { info = statSync(target); } catch { response.writeHead(404).end('Not found. Run npm run build:web first.'); return; }
  }

  response.writeHead(200, {
    'Content-Type': types[extname(target).toLowerCase()] || 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': extname(target) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  if (request.method === 'HEAD') response.end(); else createReadStream(target).pipe(response);
}).listen(port, '0.0.0.0', () => console.log(`KAC static demo listening on 0.0.0.0:${port}`));
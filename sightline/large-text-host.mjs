/**
 * Tiny static host for OCR large-text PNGs (Cloudflare tunnel workaround
 * while Chert shared-line images are disabled).
 *
 *   LARGE_TEXT_PUBLIC_DIR=./large-text-public  (default)
 *   LARGE_TEXT_HOST_PORT=8788                  (default)
 *
 *   npm run large-text:serve
 *   npm run large-text:tunnel   # prints https://….trycloudflare.com
 */
import { createServer } from 'node:http';
import { mkdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join, extname, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)));
const dir = resolve(
  process.env.LARGE_TEXT_PUBLIC_DIR || join(root, 'large-text-public'),
);
const port = Number(process.env.LARGE_TEXT_HOST_PORT || 8788);

mkdirSync(dir, { recursive: true });

const TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function safePath(urlPath) {
  const cleaned = decodeURIComponent((urlPath || '/').split('?')[0]);
  const rel = cleaned === '/' ? 'index.html' : cleaned.replace(/^\/+/, '');
  const full = resolve(dir, rel);
  if (full !== dir && !full.startsWith(dir + sep)) return null;
  return full;
}

const server = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end('Method not allowed');
    return;
  }
  const full = safePath(req.url || '/');
  if (!full || !existsSync(full) || !statSync(full).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    return;
  }
  const type = TYPES[extname(full).toLowerCase()] || 'application/octet-stream';
  const body = readFileSync(full);
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  if (req.method === 'HEAD') res.end();
  else res.end(body);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[large-text-host] serving ${dir} on http://127.0.0.1:${port}`);
});

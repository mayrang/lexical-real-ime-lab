// Tiny static server for the built Lexical playground. No dependencies.
// usage: node harness/serve.mjs <dir> [port=3013]
// Unknown paths without a file extension fall back to index.html.
import {createServer} from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {extname, join, normalize, resolve, sep} from 'node:path';

const [dirArg, portArg = '3013'] = process.argv.slice(2);
if (!dirArg) {
  console.error('usage: node harness/serve.mjs <dir> [port]');
  process.exit(2);
}
const root = resolve(dirArg);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.txt': 'text/plain',
  '.map': 'application/json', '.webmanifest': 'application/manifest+json',
};

async function pick(urlPath) {
  const p = normalize(join(root, decodeURIComponent(urlPath)));
  if (p !== root && !p.startsWith(root + sep)) return null;
  try {
    const s = await stat(p);
    if (s.isFile()) return p;
    if (s.isDirectory()) {
      const i = join(p, 'index.html');
      if ((await stat(i).catch(() => null))?.isFile()) return i;
    }
  } catch { /* not found */ }
  return extname(p) ? null : join(root, 'index.html');
}

createServer(async (req, res) => {
  const file = await pick(new URL(req.url, 'http://x').pathname);
  if (!file) {
    res.writeHead(404).end('not found');
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {'content-type': TYPES[extname(file)] ?? 'application/octet-stream'}).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(Number(portArg), '127.0.0.1', () => console.log(`serving ${root} on http://127.0.0.1:${portArg}`));

// Tiny static server for the built Lexical playground. No dependencies.
// usage: node harness/serve.mjs <dir> [port=3013]   or   import {serve} (run.mjs serves replay builds).
// Unknown paths without a file extension fall back to index.html.
// Responses are not cacheable: one port serves several builds in turn (replay group, Android Chrome keeps its cache).
import {createServer} from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {extname, join, normalize, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.txt': 'text/plain',
  '.map': 'application/json', '.webmanifest': 'application/manifest+json',
};

async function pick(root, urlPath) {
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

/**
 * Serve dir on 127.0.0.1:port. Resolves with the listening server (close it with server.close()).
 * @param {string} dir @param {number} port @returns {Promise<import('node:http').Server>}
 */
export function serve(dir, port) {
  const root = resolve(dir);
  const server = createServer(async (req, res) => {
    const file = await pick(root, new URL(req.url, 'http://x').pathname);
    if (!file) {
      res.writeHead(404).end('not found');
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, {'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store'}).end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => ok(server));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [dirArg, portArg = '3013'] = process.argv.slice(2);
  if (!dirArg) {
    console.error('usage: node harness/serve.mjs <dir> [port]');
    process.exit(2);
  }
  await serve(dirArg, Number(portArg));
  console.log(`serving ${resolve(dirArg)} on http://127.0.0.1:${portArg}`);
}

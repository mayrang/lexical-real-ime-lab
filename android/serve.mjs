// Tiny static server for the control page.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), 'pages');
http.createServer((req, res) => {
  const f = path.join(dir, path.basename(new URL(req.url, 'http://x').pathname) || 'control.html');
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); res.end(data);
  });
}).listen(Number(process.env.PORT || 3013), '0.0.0.0');

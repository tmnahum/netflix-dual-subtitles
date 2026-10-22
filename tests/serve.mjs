// Local-only browser fixture. Does not contact Netflix.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = pathname.startsWith('/watch/') ? 'tests/fixture.html' : pathname.slice(1);
  const resolved = path.resolve(root, file);
  if (!resolved.startsWith(root + '/')) { res.writeHead(403).end(); return; }
  try { const body = await fs.readFile(resolved); res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/html'); res.end(body); }
  catch { res.writeHead(404).end(); }
}).listen(5173, '127.0.0.1', () => console.log('Subbed fixture: http://127.0.0.1:5173/watch/123'));

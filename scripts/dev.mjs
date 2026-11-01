import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { build, projectRoot } from './build.mjs';

const port = Number(process.env.PORT || 8124);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT: liczba od 1024 do 65535.');
await build();
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    const relative = url.pathname === '/' ? 'dev/index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.resolve(projectRoot, relative);
    if (!file.startsWith(projectRoot + path.sep) && !file.startsWith(projectRoot)) {
      response.writeHead(403); response.end('Forbidden'); return;
    }
    // path.relative catches traversal regardless of trailing slash in projectRoot.
    if (path.relative(projectRoot, file).startsWith('..')) {
      response.writeHead(403); response.end('Forbidden'); return;
    }
    if (file === path.join(projectRoot, 'dist/ha-custom-cards.js')) await build();
    const content = await readFile(file);
    response.writeHead(200, { 'Content-Type': `${types[path.extname(file)] || 'text/plain'}; charset=utf-8`, 'Cache-Control': 'no-store' });
    response.end(content);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(error.code === 'ENOENT' ? 'Not found' : error.message);
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Podgląd: http://127.0.0.1:${port}\nOdśwież stronę po zmianie plików src/. Ctrl+C kończy serwer.`));

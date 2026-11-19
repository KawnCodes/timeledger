// Self-hosted / local development server: the same API as the Worker, backed by SQLite.
// Usage: node server/node.mjs [port] [database-file]   (Node 22.13+)
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {handle} from './worker.mjs';

// Minimal D1-compatible wrapper around node:sqlite.
export function d1(file = ':memory:') {
  const db = new DatabaseSync(file);
  db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  return {prepare(sql) {
    let args = [];
    const stmt = db.prepare(sql);
    const api = {
      bind(...values) { args = values; return api; },
      async first() { return stmt.get(...args) ?? null; },
      async all() { return {results: stmt.all(...args)}; },
      async run() { const r = stmt.run(...args); return {meta: {changes: Number(r.changes)}}; }
    };
    return api;
  }};
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const port = Number(process.argv[2] ?? 8787), env = {DB: d1(process.argv[3] ?? 'timeledger-sync.db'), ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS ?? '*'};
  createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const request = new Request('http://' + req.headers.host + req.url, {method: req.method, headers: req.headers, body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : Buffer.concat(chunks)});
    const response = await handle(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  }).listen(port, () => console.log('TimeLedger sync server on http://localhost:' + port));
}

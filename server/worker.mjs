// TimeLedger sync API. Runs on Cloudflare Workers with a D1 database bound as DB.
// The server never sees a password or plaintext ledger: clients send a key derived from the
// password with PBKDF2, and upload the ledger already encrypted with AES-GCM.
const MAX_LEDGER = 20 * 1024 * 1024, MAX_FAILURES = 10, LOCK_MS = 15 * 60 * 1000;
const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha256 = async text => hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
const random = n => hex(crypto.getRandomValues(new Uint8Array(n)));
function equal(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

function cors(request, env) {
  const allowed = (env.ALLOWED_ORIGINS ?? '*').split(',').map(s => s.trim()).filter(Boolean);
  const origin = request.headers.get('Origin');
  const allow = allowed.includes('*') ? '*' : origin && allowed.includes(origin) ? origin : allowed[0] ?? '';
  return {'Access-Control-Allow-Origin': allow, 'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin'};
}
const json = (body, status, headers) => new Response(JSON.stringify(body), {status, headers: {...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});

async function body(request) {
  const text = await request.text();
  if (text.length > MAX_LEDGER + 4096) throw new HttpError(413, 'The ledger is too large to sync.');
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'Invalid JSON.'); }
}
function credentials(b) {
  const name = typeof b?.user === 'string' ? b.user.trim().toLowerCase() : '';
  if (!/^[a-z0-9._@+-]{3,100}$/.test(name)) throw new HttpError(400, 'Use 3–100 letters, numbers or . _ @ + - for the account name.');
  if (typeof b.auth !== 'string' || !/^[0-9a-f]{64}$/.test(b.auth)) throw new HttpError(400, 'Invalid credentials.');
  return {name, auth: b.auth};
}
async function issueToken(db, name, now) {
  const token = random(32);
  await db.prepare('INSERT INTO tokens (hash, name, created_at) VALUES (?, ?, ?)').bind(await sha256(token), name, now).run();
  return token;
}
async function session(request, db) {
  const m = /^Bearer ([0-9a-f]{64})$/.exec(request.headers.get('Authorization') ?? '');
  if (!m) throw new HttpError(401, 'Sign in again.');
  const row = await db.prepare('SELECT name FROM tokens WHERE hash = ?').bind(await sha256(m[1])).first();
  if (!row) throw new HttpError(401, 'Your session has ended. Sign in again.');
  return {name: row.name, tokenHash: await sha256(m[1])};
}

async function route(request, env, now) {
  const db = env.DB, url = new URL(request.url), path = url.pathname.replace(/\/+$/, ''), method = request.method;
  if (path.endsWith('/v1/signup') && method === 'POST') {
    const {name, auth} = credentials(await body(request)), salt = random(16);
    const result = await db.prepare('INSERT OR IGNORE INTO users (name, salt, hash, created_at) VALUES (?, ?, ?, ?)').bind(name, salt, await sha256(salt + auth), now).run();
    if (!result.meta?.changes) throw new HttpError(409, 'That account name is taken. Sign in instead.');
    return [201, {token: await issueToken(db, name, now), user: name}];
  }
  if (path.endsWith('/v1/login') && method === 'POST') {
    const {name, auth} = credentials(await body(request));
    const user = await db.prepare('SELECT * FROM users WHERE name = ?').bind(name).first();
    if (user && user.locked_until > now) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
    if (!user || !equal(await sha256(user.salt + auth), user.hash)) {
      if (user) {
        const failures = user.failures + 1;
        await db.prepare('UPDATE users SET failures = ?, locked_until = ? WHERE name = ?').bind(failures >= MAX_FAILURES ? 0 : failures, failures >= MAX_FAILURES ? now + LOCK_MS : 0, name).run();
      }
      throw new HttpError(401, 'Account name or password is incorrect.');
    }
    await db.prepare('UPDATE users SET failures = 0, locked_until = 0 WHERE name = ?').bind(name).run();
    return [200, {token: await issueToken(db, name, now), user: name}];
  }
  if (path.endsWith('/v1/logout') && method === 'POST') {
    const s = await session(request, db);
    await db.prepare('DELETE FROM tokens WHERE hash = ?').bind(s.tokenHash).run();
    return [200, {ok: true}];
  }
  if (path.endsWith('/v1/ledger') && method === 'GET') {
    const s = await session(request, db);
    const row = await db.prepare('SELECT version, data, updated_at FROM ledgers WHERE name = ?').bind(s.name).first();
    return [200, row ? {version: row.version, data: row.data, updatedAt: row.updated_at} : {version: 0, data: null, updatedAt: null}];
  }
  if (path.endsWith('/v1/ledger') && method === 'PUT') {
    const s = await session(request, db), b = await body(request);
    if (typeof b?.data !== 'string' || !b.data || b.data.length > MAX_LEDGER || !Number.isSafeInteger(b.baseVersion) || b.baseVersion < 0) throw new HttpError(400, 'Invalid ledger upload.');
    const version = b.baseVersion + 1;
    const result = b.baseVersion === 0
      ? await db.prepare('INSERT OR IGNORE INTO ledgers (name, version, data, updated_at) VALUES (?, ?, ?, ?)').bind(s.name, version, b.data, now).run()
      : await db.prepare('UPDATE ledgers SET version = ?, data = ?, updated_at = ? WHERE name = ? AND version = ?').bind(version, b.data, now, s.name, b.baseVersion).run();
    if (!result.meta?.changes) throw new HttpError(409, 'Another device saved first.');
    return [200, {version, updatedAt: now}];
  }
  if (path.endsWith('/v1/account') && method === 'DELETE') {
    const s = await session(request, db);
    for (const table of ['ledgers', 'tokens', 'users']) await db.prepare('DELETE FROM ' + table + ' WHERE name = ?').bind(s.name).run();
    return [200, {ok: true}];
  }
  throw new HttpError(404, 'Not found.');
}

export async function handle(request, env, now = Date.now()) {
  const headers = cors(request, env);
  if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers});
  try { const [status, payload] = await route(request, env, now); return json(payload, status, headers); }
  catch (err) { return json({error: err instanceof HttpError ? err.message : 'Server error.'}, err.status ?? 500, headers); }
}
export default {fetch: (request, env) => handle(request, env)};

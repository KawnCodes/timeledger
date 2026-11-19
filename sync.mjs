// GitHub sync. The ledger is stored as a readable JSON file in a GitHub repository
// and every device reads and writes it with a personal access token. The file's Git SHA is
// the version, so GitHub itself rejects an upload based on an out-of-date copy.
import {emptyState, syncMerge, validate, requireThat} from './core.mjs';
const enc = new TextEncoder(), dec = new TextDecoder();
const API = 'https://api.github.com';
const toB64 = text => { const u = enc.encode(text); let t = ''; for (let i = 0; i < u.length; i += 0x8000) t += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(t); };
const fromB64 = b64 => dec.decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0)));

// Fields that belong to this device only and are never shared.
const local = ['theme', 'collapsed', 'backupAt', 'period', 'sound'];
export function shareable(state) {
  const s = structuredClone(state);
  for (const k of local) delete s.settings[k];
  delete s.demoOffset;
  return s;
}
export function withLocal(remote, current) {
  const s = structuredClone(remote);
  for (const k of local) s.settings[k] = current.settings[k];
  return validate(s);
}
export const encodeFile = (state, at = Date.now()) => JSON.stringify({application: 'TimeLedger', format: 'sync-1', updatedAt: new Date(at).toISOString(), data: state}, null, 2) + '\n';
export function decodeFile(text) {
  let file;
  try { file = JSON.parse(text); } catch { throw new Error('The ledger file in the repository is not valid JSON.'); }
  requireThat(file?.application === 'TimeLedger' && file.data && typeof file.data === 'object', 'The file in the repository is not a TimeLedger ledger.');
  return file.data;
}
export function parseRepo(value) {
  const m = /^(?:https:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(String(value ?? '').trim());
  requireThat(m, 'Enter the repository as owner/name, for example you/timeledger-data.');
  return m[1] + '/' + m[2];
}
// Content comparison that ignores key order and the order of records with IDs.
function canon(v) {
  if (Array.isArray(v)) { const items = v.map(canon); return '[' + (v.every(x => x && typeof x === 'object' && 'id' in x) ? items.sort() : items).join(',') + ']'; }
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
export const sameData = (a, b) => canon(a) === canon(b);
const isEmpty = s => !['companies', 'projects', 'entries'].some(k => s[k].length);

export function createSync({ledger, fetch: f = (...a) => fetch(...a)}) {
  let meta = null, running = null, again = false, changed = false;
  const listeners = new Set(), status = {state: 'signed-out', at: null, error: ''};
  const emit = patch => { Object.assign(status, patch); for (const fn of listeners) fn(status); };
  async function gh(path, {method = 'GET', body, token = meta?.token} = {}) {
    let res;
    try {
      res = await f(API + path, {method, cache: 'no-store', headers: {Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28', ...(body ? {'Content-Type': 'application/json'} : {})}, body: body === undefined ? undefined : JSON.stringify(body)});
    } catch { const e = new Error('Unable to reach GitHub.'); e.offline = true; throw e; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(res.status === 401 ? 'GitHub rejected the token. It may have expired — sign in again with a new one.'
        : res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0' ? 'GitHub rate limit reached. Sync will resume shortly.'
        : res.status === 403 || (res.status === 404 && !path.includes('/contents/')) ? 'The token cannot access that repository. Give it Contents: read and write on that repository.'
        : data.message ? 'GitHub: ' + data.message : 'GitHub request failed (' + res.status + ').');
      e.status = res.status; throw e;
    }
    return data;
  }
  const contentsPath = m => '/repos/' + m.repo + '/contents/' + m.path.split('/').map(encodeURIComponent).join('/');
  // Read the ledger file: {version: sha|null, state|null}.
  async function pull(m) {
    let file;
    try { file = await gh(contentsPath(m) + '?ref=' + encodeURIComponent(m.branch), {token: m.token}); }
    catch (err) { if (err.status === 404) return {version: null, state: null}; throw err; }
    requireThat(file.type === 'file', 'The ledger path in the repository is a folder. Choose a file name.');
    // Files over 1 MB come without inline content; fetch the blob instead.
    const content = file.encoding === 'base64' && file.content ? file.content : (await gh('/repos/' + m.repo + '/git/blobs/' + file.sha, {token: m.token})).content;
    return {version: file.sha, state: decodeFile(fromB64(content))};
  }
  async function push(m, state, version) {
    const out = await gh(contentsPath(m), {method: 'PUT', token: m.token, body: {message: 'Update TimeLedger data', content: toB64(encodeFile(state)), branch: m.branch, ...(version ? {sha: version} : {})}});
    return out.content.sha;
  }
  async function save(next) { meta = next; await ledger.writeMeta(meta); }

  // Check the token and repository, then report what the user must decide before data moves.
  async function signIn({token, repo, path = 'timeledger.json'}) {
    token = String(token ?? '').trim();
    requireThat(/^[\w-]{20,255}$/.test(token), 'Paste a GitHub personal access token.');
    repo = parseRepo(repo);
    path = String(path || 'timeledger.json').trim().replace(/^\/+/, '');
    requireThat(/^[\w./ -]+\.json$/.test(path) && !path.includes('..'), 'Use a file name ending in .json.');
    const user = await gh('/user', {token});
    const info = await gh('/repos/' + repo, {token});
    requireThat(!info.permissions || info.permissions.push, 'The token can read but not write that repository. Give it Contents: read and write.');
    const pending = {token, repo: info.full_name, path, branch: info.default_branch, user: user.login, public: !info.private, version: null, base: null, pending: true};
    const remote = await pull(pending);
    const remoteState = remote.state ? withLocal(remote.state, await ledger.read()) : null;
    const current = await ledger.read();
    await save(pending);
    const choice = !remoteState || isEmpty(remoteState) ? 'upload' : isEmpty(current) ? 'download' : 'ask';
    return {choice, remote: remoteState, remoteVersion: remote.version, counts: remoteState && {entries: remoteState.entries.length, projects: remoteState.projects.length, companies: remoteState.companies.length}};
  }
  // mode: 'merge' combines both; 'replace' replaces this device with the repository copy;
  // 'upload' replaces the repository copy with this device.
  async function finishSignIn(mode, remote, remoteVersion) {
    requireThat(meta?.pending, 'Sign in first.');
    let state;
    if (mode === 'replace') state = await ledger.write(cur => withLocal(remote, cur));
    else if (mode === 'merge') state = await ledger.write(cur => syncMerge(emptyState(), cur, withLocal(remote, cur)));
    else state = await ledger.read();
    await save({...meta, pending: false, version: remoteVersion, base: mode === 'upload' || !remote ? null : shareable(remote)});
    await syncNow();
    if (status.state === 'error') throw new Error(status.error);
    return state;
  }
  async function cycle() {
    const remote = await pull(meta);
    let state = await ledger.read();
    if (remote.version !== meta.version) {
      const theirs = remote.state ? withLocal(remote.state, state) : null;
      if (theirs) {
        const base = meta.base ? withLocal(meta.base, state) : emptyState();
        state = await ledger.write(cur => syncMerge(withLocal(base, cur), cur, withLocal(theirs, cur)));
        changed = true;
      }
      await save({...meta, version: remote.version, base: theirs ? shareable(theirs) : null});
    }
    const mine = shareable(state);
    if (meta.base && sameData(mine, meta.base)) return false;
    try {
      const version = await push(meta, mine, meta.version);
      await save({...meta, version, base: mine});
      return false;
    } catch (err) { if (err.status === 409 || err.status === 422) return true; throw err; }
  }
  async function run() {
    meta = await ledger.readMeta();
    if (!meta || meta.pending) return;
    emit({state: 'syncing', error: ''});
    try {
      let retry = true; changed = false;
      for (let i = 0; retry && i < 4; i++) retry = await cycle();
      emit({state: 'synced', at: Date.now(), error: '', changed});
    } catch (err) {
      if (err.status === 401) { await save(null); emit({state: 'signed-out', error: err.message}); return; }
      emit({state: err.offline ? 'offline' : 'error', error: err.message});
    }
  }
  function syncNow() {
    if (running) { again = true; return running; }
    running = run().finally(() => { running = null; if (again) { again = false; syncNow(); } });
    return running;
  }
  return {
    status, onChange: fn => listeners.add(fn), signIn, finishSignIn, syncNow,
    async load() { meta = await ledger.readMeta(); if (meta?.pending || (meta && !meta.repo)) await save(null); emit({state: meta ? 'idle' : 'signed-out'}); return meta; },
    get account() { return meta && !meta.pending ? {user: meta.user, repo: meta.repo, path: meta.path, public: !!meta.public} : null; },
    async cancelSignIn() { if (meta?.pending) await save(null); },
    async signOut() { await save(null); emit({state: 'signed-out', error: ''}); }
  };
}

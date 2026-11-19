// Account sync. The password never leaves the device: PBKDF2 derives a login key (sent to the
// server) and a separate AES-GCM key that encrypts the whole ledger before upload.
import {emptyState, syncMerge, validate, requireThat} from './core.mjs';
const enc = new TextEncoder(), dec = new TextDecoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const b64 = buf => { const u = new Uint8Array(buf); let t = ''; for (let i = 0; i < u.length; i += 0x8000) t += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(t); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export const ITERATIONS = 310000;
export const normalUser = u => String(u ?? '').trim().toLowerCase();

export async function deriveKeys(user, password, iterations = ITERATIONS) {
  requireThat(normalUser(user).length >= 3, 'Enter an account name of at least 3 characters.');
  requireThat(String(password).length >= 8, 'Use a password of at least 8 characters.');
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('timeledger-sync-v1:' + normalUser(user)), iterations}, material, 512));
  return {auth: hex(bits.slice(0, 32)), key: b64(bits.slice(32))};
}
const aes = key => crypto.subtle.importKey('raw', unb64(key), 'AES-GCM', false, ['encrypt', 'decrypt']);
export async function encrypt(state, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({name: 'AES-GCM', iv}, await aes(key), enc.encode(JSON.stringify(state)));
  return JSON.stringify({v: 1, iv: b64(iv), ct: b64(ct)});
}
export async function decrypt(text, key) {
  const box = JSON.parse(text);
  try { return (JSON.parse(dec.decode(await crypto.subtle.decrypt({name: 'AES-GCM', iv: unb64(box.iv)}, await aes(key), unb64(box.ct))))); }
  catch (err) { throw new Error(err?.name === 'OperationError' ? 'Unable to decrypt the account data. Check the password.' : err.message); }
}
// Fields that belong to this device only and are never shared.
const local = ['theme', 'collapsed', 'backupAt', 'period'];
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
const isEmpty = s => !['companies', 'projects', 'entries'].some(k => s[k].length);

export function createSync({ledger, fetch: f = (...a) => fetch(...a)}) {
  let meta = null, running = null, again = false, changed = false;
  const listeners = new Set(), status = {state: 'signed-out', at: null, error: ''};
  const emit = patch => { Object.assign(status, patch); for (const fn of listeners) fn(status); };
  async function api(path, {method = 'GET', body, token = meta?.token, server = meta?.server} = {}) {
    let res;
    try {
      res = await f(server.replace(/\/+$/, '') + path, {method, headers: {'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {})}, body: body === undefined ? undefined : JSON.stringify(body)});
    } catch { const e = new Error('Unable to reach the sync server.'); e.offline = true; throw e; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error ?? 'Sync failed (' + res.status + ').'); e.status = res.status; throw e; }
    return data;
  }
  async function save(next) { meta = next; await ledger.writeMeta(meta); }

  // Sign in (or create an account). Resolves with what the user must decide before data moves.
  async function signIn({server, user, password, create = false}) {
    requireThat(/^https?:\/\/[^\s]+$/.test(String(server ?? '').trim()), 'Enter the sync server address, starting with https://.');
    server = server.trim().replace(/\/+$/, '');
    const {auth, key} = await deriveKeys(user, password);
    const out = await api(create ? '/v1/signup' : '/v1/login', {method: 'POST', body: {user: normalUser(user), auth}, token: null, server});
    const pending = {server, user: out.user, token: out.token, key, version: 0, base: null, pending: true};
    const remote = await api('/v1/ledger', {token: out.token, server});
    const remoteState = remote.data ? await decrypt(remote.data, key) : null;
    const current = await ledger.read();
    await save(pending);
    const choice = !remoteState || isEmpty(remoteState) ? 'upload' : isEmpty(current) ? 'download' : 'ask';
    return {choice, remote: remoteState, remoteVersion: remote.version, counts: remoteState && {entries: remoteState.entries.length, projects: remoteState.projects.length, companies: remoteState.companies.length}};
  }
  // mode: 'merge' combines both; 'replace' replaces this device with the account copy;
  // 'upload' replaces the account copy with this device.
  async function finishSignIn(mode, remote, remoteVersion) {
    requireThat(meta?.pending, 'Sign in first.');
    let state;
    if (mode === 'replace') state = await ledger.write(cur => withLocal(remote, cur));
    else if (mode === 'merge') state = await ledger.write(cur => syncMerge(emptyState(), cur, withLocal(remote, cur)));
    else state = await ledger.read();
    await save({...meta, pending: false, version: remoteVersion, base: mode === 'upload' ? null : shareable(remote)});
    await syncNow();
    return state;
  }
  async function cycle() {
    const remote = await api('/v1/ledger');
    let state = await ledger.read();
    if (remote.version !== meta.version) {
      const theirs = remote.data ? await decrypt(remote.data, meta.key) : emptyState();
      const base = meta.base ?? emptyState();
      state = await ledger.write(cur => syncMerge(withLocal(base, cur), cur, withLocal(theirs, cur)));
      await save({...meta, version: remote.version, base: shareable(theirs)});
      changed = true;
    }
    const mine = shareable(state);
    if (meta.base && JSON.stringify(mine) === JSON.stringify(meta.base)) return false;
    try {
      const put = await api('/v1/ledger', {method: 'PUT', body: {baseVersion: meta.version, data: await encrypt(mine, meta.key)}});
      await save({...meta, version: put.version, base: mine});
      return false;
    } catch (err) { if (err.status === 409) return true; throw err; }
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
    async load() { meta = await ledger.readMeta(); if (meta?.pending) await save(null); emit({state: meta ? 'idle' : 'signed-out'}); return meta; },
    get account() { return meta && !meta.pending ? {user: meta.user, server: meta.server} : null; },
    async cancelSignIn() { if (meta?.pending) await save(null); },
    async signOut() { const m = meta; await save(null); emit({state: 'signed-out', error: ''}); try { await api('/v1/logout', {method: 'POST', token: m?.token, server: m?.server}); } catch {} }
  };
}

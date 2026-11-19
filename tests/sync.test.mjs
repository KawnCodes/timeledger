import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState, validate, setRate, manual, summary, totalIn, convert, goal, saveGoal, syncMerge, HOUR} from '../docs/core.mjs';
import {createSync, encrypt, decrypt, deriveKeys} from '../docs/sync.mjs';
import {handle} from '../server/worker.mjs';
import {d1} from '../server/node.mjs';

function ledgerWith(currencies) {
  const s = emptyState();
  currencies.forEach((cc, i) => {
    s.companies.push({id: 'c' + i, name: 'Co ' + cc, color: '#123456', currency: cc, notes: '', billing: ''});
    s.projects.push({id: 'p' + i, companyId: 'c' + i, name: 'P ' + cc, ref: '', notes: '', archived: false, favourite: false, order: i, recent: 0});
    setRate(s, 'company', 'c' + i, 10000, cc, 0);
  });
  return s;
}
const work = (s, p, start, hours) => { const e = manual(s, p, start, start + hours * HOUR); Object.assign(e, {billable: true, approved: hours * HOUR}); s.entries.push(e); return e; };

test('earnings in several currencies combine into the goal currency', () => {
  const s = ledgerWith(['GBP', 'USD', 'EUR']);
  s.settings.fx = {rates: {EUR: 1, GBP: 0.8, USD: 1.25, CAD: 1.5, AUD: 1.6, CHF: 0.9, NZD: 1.8}, at: null, source: 'manual'};
  const t = Date.UTC(2026, 0, 5, 9);
  work(s, 'p0', t, 1); work(s, 'p1', t + 2 * HOUR, 2); work(s, 'p2', t + 5 * HOUR, 1);
  validate(s);
  const sum = summary(s.entries, [t, t + 24 * HOUR], t + 24 * HOUR);
  assert.deepEqual(sum.money, {GBP: 10000, USD: 20000, EUR: 10000});
  // £100 + $200 (= £128) + €100 (= £80); in USD: $156.25 + $200 + $125
  assert.equal(totalIn(sum.money, 'GBP', s.settings.fx), 30800);
  // Switching the goal currency does not lose any earnings.
  assert.equal(totalIn(sum.money, 'USD', s.settings.fx), 48125);
  assert.equal(convert(12345, 'GBP', 'GBP', s.settings.fx), 12345);
});

test('goals keep their target after the goal currency changes', () => {
  const s = ledgerWith(['GBP']);
  s.settings.fx = {rates: {EUR: 1, GBP: 0.8, USD: 1.2, CAD: 1.5, AUD: 1.6, CHF: 0.9, NZD: 1.8}, at: null, source: 'manual'};
  const at = Date.UTC(2026, 2, 4, 12);
  saveGoal(s, 'week', at, 40, 80000, 'defaults');
  s.settings.currency = 'USD';
  const g = goal(s, 'week', at + 7 * 24 * HOUR);
  assert.equal(g.hours, 40);
  assert.equal(g.money, 120000);
  assert.equal(g.sourceCurrency, 'GBP');
  saveGoal(s, 'week', at, 40, 100000, 'defaults');
  assert.equal(s.defaults.length, 1, 'saving in the new currency replaces the old target');
  assert.equal(goal(s, 'week', at).money, 100000);
  validate(s);
});

test('older ledgers without exchange rates still load', () => {
  const s = ledgerWith(['EUR']);
  delete s.settings.fx;
  assert.equal(validate(s).settings.fx.source, 'built-in');
});

test('three-way merge combines devices, applies deletions and keeps edits', () => {
  const base = ledgerWith(['GBP']);
  const t = Date.UTC(2026, 0, 5, 9);
  const shared = work(base, 'p0', t, 1), gone = work(base, 'p0', t + 2 * HOUR, 1);
  validate(base);
  const local = structuredClone(base), remote = structuredClone(base);
  work(local, 'p0', t + 4 * HOUR, 1);                       // new on this device
  const fresh = work(remote, 'p0', t + 6 * HOUR, 1);         // new on the other device
  remote.entries = remote.entries.filter(e => e.id !== gone.id); // deleted elsewhere
  Object.assign(remote.entries.find(e => e.id === shared.id), {notes: 'edited remotely', revision: 5});
  remote.settings.currency = 'USD'; local.settings.weekStart = 0;
  const merged = syncMerge(base, local, remote);
  assert.equal(merged.entries.length, 3);
  assert.ok(merged.entries.some(e => e.id === fresh.id));
  assert.ok(!merged.entries.some(e => e.id === gone.id));
  assert.equal(merged.entries.find(e => e.id === shared.id).notes, 'edited remotely');
  assert.equal(merged.settings.currency, 'USD');
  assert.equal(merged.settings.weekStart, 0);
  // Edited on both sides: the higher revision wins.
  const l2 = structuredClone(merged), r2 = structuredClone(merged);
  Object.assign(l2.entries[0], {notes: 'local', revision: 9});
  Object.assign(r2.entries[0], {notes: 'remote', revision: 7});
  assert.equal(syncMerge(merged, l2, r2).entries[0].notes, 'local');
});

function memoryLedger(state) {
  let value = validate(state), meta = null;
  return {
    get state() { return value; },
    async read() { return structuredClone(value); },
    async write(fn) { const draft = structuredClone(value); const next = fn(draft) ?? draft; value = validate(next); return structuredClone(value); },
    async readMeta() { return structuredClone(meta); },
    async writeMeta(v) { meta = structuredClone(v); }
  };
}
function server() {
  const env = {DB: d1(), ALLOWED_ORIGINS: '*'};
  return async (url, init) => handle(new Request(url, init), env);
}

test('ledger encryption round trip rejects a wrong key', async () => {
  const s = ledgerWith(['GBP']);
  const {key} = await deriveKeys('someone', 'correct horse', 1000), other = await deriveKeys('someone', 'wrong horse', 1000);
  const box = await encrypt(s, key);
  assert.ok(!box.includes('Co GBP'));
  assert.deepEqual(await decrypt(box, key), s);
  await assert.rejects(decrypt(box, other.key), /decrypt/);
});

test('accounts sync between devices with merge and replace on sign-in', async () => {
  const f = server(), url = 'https://sync.test';
  const t = Date.UTC(2026, 0, 5, 9);
  const phoneState = ledgerWith(['GBP']); work(phoneState, 'p0', t, 1);
  const phone = memoryLedger(phoneState), a = createSync({ledger: phone, fetch: f});
  await a.load();
  await assert.rejects(a.signIn({server: url, user: 'me@example.com', password: 'short', create: true}), /8 characters/);
  const first = await a.signIn({server: url, user: 'Me@Example.com', password: 'correct horse', create: true});
  assert.equal(first.choice, 'upload');
  await a.finishSignIn('upload', first.remote, first.remoteVersion);
  assert.equal(a.status.state, 'synced');
  assert.equal(a.account.user, 'me@example.com');

  // A second device with its own records chooses to merge.
  const laptopState = ledgerWith(['USD']); laptopState.companies[0].id = 'c-usd'; laptopState.projects[0].id = 'p-usd'; laptopState.projects[0].companyId = 'c-usd';
  laptopState.rates = []; setRate(laptopState, 'company', 'c-usd', 9000, 'USD', 0); work(laptopState, 'p-usd', t + 3 * HOUR, 2);
  const laptop = memoryLedger(laptopState), b = createSync({ledger: laptop, fetch: f});
  await b.load();
  await assert.rejects(b.signIn({server: url, user: 'me@example.com', password: 'wrong password'}), /incorrect/);
  const second = await b.signIn({server: url, user: 'me@example.com', password: 'correct horse'});
  assert.equal(second.choice, 'ask');
  assert.equal(second.counts.entries, 1);
  await b.finishSignIn('merge', second.remote, second.remoteVersion);
  assert.equal(laptop.state.entries.length, 2);
  assert.equal(laptop.state.settings.currency, 'GBP');

  // The phone picks up the merged ledger, then a deletion travels back.
  await a.syncNow();
  assert.equal(phone.state.entries.length, 2);
  await phone.write(s => { s.entries = s.entries.filter(e => e.projectId !== 'p-usd'); });
  await a.syncNow(); await b.syncNow();
  assert.equal(laptop.state.entries.length, 1);

  // Concurrent offline edits on both devices both survive.
  await phone.write(s => { work(s, 'p0', t + 8 * HOUR, 1); });
  await laptop.write(s => { work(s, 'p0', t + 10 * HOUR, 1); });
  await a.syncNow(); await b.syncNow(); await a.syncNow();
  assert.equal(phone.state.entries.length, 3);
  assert.deepEqual(phone.state.entries.map(e => e.id).sort(), laptop.state.entries.map(e => e.id).sort());

  // A third device replaces its data with the account copy.
  const tablet = memoryLedger(ledgerWith(['EUR'])), c = createSync({ledger: tablet, fetch: f});
  await c.load();
  const third = await c.signIn({server: url, user: 'me@example.com', password: 'correct horse'});
  await c.finishSignIn('replace', third.remote, third.remoteVersion);
  assert.equal(tablet.state.entries.length, 3);
  assert.ok(!tablet.state.companies.some(x => x.currency === 'EUR'));

  // Signing out ends the server session.
  await c.signOut();
  assert.equal(c.account, null);
});

test('server rejects stale uploads and bad tokens', async () => {
  const f = server(), url = 'https://sync.test';
  const {auth} = await deriveKeys('alice', 'password123', 1000);
  const post = (path, body, token) => f(url + path, {method: 'POST', headers: {'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {})}, body: JSON.stringify(body)});
  const {token} = await (await post('/v1/signup', {user: 'alice', auth})).json();
  assert.equal((await post('/v1/signup', {user: 'alice', auth})).status, 409);
  const put = (baseVersion, tok = token) => f(url + '/v1/ledger', {method: 'PUT', headers: {Authorization: 'Bearer ' + tok}, body: JSON.stringify({baseVersion, data: 'x'})});
  assert.equal((await put(0)).status, 200);
  assert.equal((await put(0)).status, 409);
  assert.equal((await put(1)).status, 200);
  assert.equal((await put(2, 'f'.repeat(64))).status, 401);
  const got = await (await f(url + '/v1/ledger', {headers: {Authorization: 'Bearer ' + token}})).json();
  assert.equal(got.version, 2);
  assert.equal((await f(url + '/v1/ledger', {method: 'OPTIONS'})).status, 204);
});

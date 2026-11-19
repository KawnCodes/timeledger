import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState, validate, setRate, manual, summary, totalIn, convert, goal, saveGoal, syncMerge, rateAt, projectCurrency, deleteCompany, deleteProjects, timer, HOUR} from '../docs/core.mjs';
import {createSync, encodeFile, decodeFile, parseRepo, shareable} from '../docs/sync.mjs';

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
// A small stand-in for the GitHub REST API: users, repositories and the contents endpoint.
function fakeGitHub({repoPrivate = true, token = 'github_pat_' + 'x'.repeat(30)} = {}) {
  const files = new Map(), blobs = new Map(); let n = 0, commits = 0;
  const reply = (status, body) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
  const fetch = async (url, init = {}) => {
    const u = new URL(url), method = init.method ?? 'GET';
    if (init.headers?.Authorization !== 'Bearer ' + token) return reply(401, {message: 'Bad credentials'});
    if (u.pathname === '/user') return reply(200, {login: 'me'});
    if (u.pathname === '/repos/me/data') return reply(200, {full_name: 'me/data', private: repoPrivate, default_branch: 'main', permissions: {push: true}});
    const blob = /^\/repos\/me\/data\/git\/blobs\/(\w+)$/.exec(u.pathname);
    if (blob) return reply(200, {content: blobs.get(blob[1]), encoding: 'base64'});
    const m = /^\/repos\/me\/data\/contents\/(.+)$/.exec(u.pathname);
    if (!m) return reply(404, {message: 'Not Found'});
    const path = decodeURIComponent(m[1]), cur = files.get(path);
    if (method === 'GET') {
      if (!cur) return reply(404, {message: 'Not Found'});
      const large = cur.content.length > 2000; // pretend large files need the blob API
      return reply(200, {type: 'file', sha: cur.sha, encoding: large ? 'none' : 'base64', content: large ? '' : cur.content});
    }
    const body = JSON.parse(init.body);
    if (cur && body.sha !== cur.sha) return reply(409, {message: 'does not match'});
    if (!cur && body.sha) return reply(409, {message: 'does not match'});
    const sha = 'sha' + (++n); commits++;
    files.set(path, {sha, content: body.content}); blobs.set(sha, body.content);
    return reply(cur ? 200 : 201, {content: {sha}});
  };
  return {fetch, token, files, get commits() { return commits; }};
}

test('repository file is readable JSON and round-trips', () => {
  const s = ledgerWith(['GBP']);
  const text = encodeFile(shareable(s));
  assert.match(text, /"application": "TimeLedger"/);
  assert.match(text, /"name": "Co GBP"/);
  assert.equal(decodeFile(text).companies[0].name, 'Co GBP');
  assert.throws(() => decodeFile('{"hello":1}'), /not a TimeLedger/);
  assert.equal(parseRepo('https://github.com/me/data.git'), 'me/data');
  assert.throws(() => parseRepo('nope'), /owner\/name/);
});

test('public repositories are allowed and bad tokens are refused', async () => {
  const pub = fakeGitHub({repoPrivate: false});
  const a = createSync({ledger: memoryLedger(ledgerWith(['GBP'])), fetch: pub.fetch});
  await a.load();
  assert.equal((await a.signIn({token: pub.token, repo: 'me/data'})).choice, 'upload');
  await a.finishSignIn('upload', null, null);
  assert.equal(a.account.public, true);
  const gh = fakeGitHub();
  await assert.rejects(createSync({ledger: memoryLedger(ledgerWith(['GBP'])), fetch: gh.fetch}).signIn({token: 'github_pat_' + 'y'.repeat(30), repo: 'me/data'}), /rejected the token/);
});

test('devices sync through a GitHub file with merge and replace on sign-in', async () => {
  const gh = fakeGitHub(), repo = 'me/data', token = gh.token;
  const t = Date.UTC(2026, 0, 5, 9);
  const phoneState = ledgerWith(['GBP']); work(phoneState, 'p0', t, 1);
  const phone = memoryLedger(phoneState), a = createSync({ledger: phone, fetch: gh.fetch});
  await a.load();
  const first = await a.signIn({token, repo});
  assert.equal(first.choice, 'upload');
  await a.finishSignIn('upload', first.remote, first.remoteVersion);
  assert.equal(a.status.state, 'synced');
  assert.deepEqual(a.account, {user: 'me', repo, path: 'timeledger.json', public: false});
  const stored = JSON.parse(Buffer.from(gh.files.get('timeledger.json').content, 'base64').toString());
  assert.equal(stored.data.entries.length, 1);
  assert.equal(stored.data.settings.theme, undefined, 'device-only settings stay on the device');

  // A second device with its own records chooses to merge.
  const laptopState = ledgerWith(['USD']); laptopState.companies[0].id = 'c-usd'; laptopState.projects[0].id = 'p-usd'; laptopState.projects[0].companyId = 'c-usd';
  laptopState.rates = []; setRate(laptopState, 'company', 'c-usd', 9000, 'USD', 0); work(laptopState, 'p-usd', t + 3 * HOUR, 2);
  const laptop = memoryLedger(laptopState), b = createSync({ledger: laptop, fetch: gh.fetch});
  await b.load();
  const second = await b.signIn({token, repo});
  assert.equal(second.choice, 'ask');
  assert.equal(second.counts.entries, 1);
  await b.finishSignIn('merge', second.remote, second.remoteVersion);
  assert.equal(laptop.state.entries.length, 2);

  // The phone picks up the merged ledger, then a deletion travels back.
  await a.syncNow();
  assert.equal(phone.state.entries.length, 2);
  await phone.write(s => { s.entries = s.entries.filter(e => e.projectId !== 'p-usd'); });
  await a.syncNow(); await b.syncNow();
  assert.equal(laptop.state.entries.length, 1);

  // Concurrent offline edits on both devices both survive; a stale upload is retried after merging.
  await phone.write(s => { work(s, 'p0', t + 8 * HOUR, 1); });
  await laptop.write(s => { work(s, 'p0', t + 10 * HOUR, 1); });
  await a.syncNow(); await b.syncNow(); await a.syncNow();
  assert.equal(phone.state.entries.length, 3);
  assert.deepEqual(phone.state.entries.map(e => e.id).sort(), laptop.state.entries.map(e => e.id).sort());

  // Nothing changed: no extra commit.
  const before = gh.commits; await a.syncNow(); await b.syncNow();
  assert.equal(gh.commits, before);

  // A third device replaces its data with the repository copy (the file is now "large").
  const tablet = memoryLedger(ledgerWith(['EUR'])), c = createSync({ledger: tablet, fetch: gh.fetch});
  await c.load();
  const third = await c.signIn({token, repo});
  await c.finishSignIn('replace', third.remote, third.remoteVersion);
  assert.equal(tablet.state.entries.length, 3);
  await c.signOut();
  assert.equal(c.account, null);
});

test('projects can bill in their own currency', () => {
  const s = ledgerWith(['GBP']); // company c0 bills £100/h
  s.settings.fx = {rates: {EUR: 1, GBP: 0.8, USD: 1.2, CAD: 1.5, AUD: 1.6, CHF: 0.9, NZD: 1.8}, at: null, source: 'manual'};
  const p = s.projects[0];
  assert.deepEqual(rateAt(s, p, 10), {rate: 10000, currency: 'GBP'});
  // Own currency without an override: the company rate is converted (£100 → $150).
  p.currency = 'USD';
  assert.deepEqual(rateAt(s, p, 10), {rate: 15000, currency: 'USD'});
  // An override in the project's currency wins.
  setRate(s, 'project', p.id, 12000, 'USD', 5);
  assert.deepEqual(rateAt(s, p, 10), {rate: 12000, currency: 'USD'});
  const e = manual(s, p.id, Date.UTC(2026, 0, 5, 9), Date.UTC(2026, 0, 5, 11)); Object.assign(e, {billable: true, approved: 2 * HOUR}); s.entries.push(e);
  assert.equal(e.currency, 'USD');
  validate(s);
  assert.deepEqual(summary(s.entries, [0, Date.UTC(2027, 0, 1)], Date.UTC(2027, 0, 1)).money, {USD: 24000});
  assert.equal(projectCurrency(s, p), 'USD');
  p.currency = 'XYZ';
  assert.throws(() => validate(s), /project/);
});

test('deleting a company removes its projects and everything recorded against them', () => {
  const s = ledgerWith(['GBP', 'USD']);
  const keep = work(s, 'p1', Date.UTC(2026, 0, 5, 9), 1);
  const gone = work(s, 'p0', Date.UTC(2026, 0, 6, 9), 1); gone.status = 'Paid';
  s.payments.push({id: 'pay', entryId: gone.id, amount: 100, currency: 'GBP', at: 1});
  s.adjustments.push({id: 'adj', entryId: gone.id, previous: null, approved: HOUR, at: 1});
  setRate(s, 'project', 'p0', 5000, 'GBP', 1);
  s.targets.push({id: 't0', kind: 'company', owner: 'c0', period: 'week', hours: 5, money: null}, {id: 't1', kind: 'project', owner: 'p0', period: 'week', hours: 5, money: null});
  validate(s);
  timer(s, 'start', 'p0', Date.UTC(2026, 0, 7, 9));
  assert.throws(() => deleteCompany(s, 'c0'), /Stop the running timer/);
  timer(s, 'stop', 'p0', Date.UTC(2026, 0, 7, 10));
  assert.equal(deleteCompany(s, 'c0'), 2);
  validate(s);
  assert.deepEqual(s.companies.map(c => c.id), ['c1']);
  assert.deepEqual(s.projects.map(p => p.id), ['p1']);
  assert.deepEqual(s.entries.map(e => e.id), [keep.id]);
  assert.equal(s.payments.length + s.adjustments.length + s.targets.length, 0);
  assert.ok(s.rates.every(r => r.owner === 'c1'));
  assert.equal(deleteProjects(s, ['p1']), 1);
  assert.equal(validate(s).entries.length, 0);
});

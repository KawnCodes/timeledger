import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState, validate, setRate, manual, timer, saveGoal, keyDate, localDate, HOUR, MIN} from '../docs/core.mjs';
import {play, dayBuckets, streaks, levelFor, xpForLevel, live, pace, targetProgress, goalResult, totals} from '../docs/game.mjs';

function ledger() {
  const s = emptyState();
  s.settings.fx = {rates: {EUR: 1, GBP: 0.8, USD: 1.2, CAD: 1.5, AUD: 1.6, CHF: 0.9, NZD: 1.8}, at: null, source: 'manual'};
  for (const [i, cc] of ['GBP', 'USD'].entries()) {
    s.companies.push({id: 'c' + i, name: 'Co' + i, color: '#123456', currency: cc, notes: '', billing: ''});
    s.projects.push({id: 'p' + i, companyId: 'c' + i, name: 'P' + i, ref: '', notes: '', archived: false, favourite: true, order: i, recent: 0});
    setRate(s, 'company', 'c' + i, 6000, cc, 0); // 60 per hour
  }
  return s;
}
const at = (key, h) => +localDate(key) + h * HOUR;
const work = (s, p, key, h0, hours) => { const e = manual(s, p, at(key, h0), at(key, h0 + hours)); s.entries.push(e); return e; };

test('levels grow on a widening curve', () => {
  assert.equal(levelFor(0), 1);
  assert.equal(levelFor(99), 1);
  assert.equal(levelFor(100), 2);
  assert.equal(levelFor(300), 3);
  assert.equal(levelFor(xpForLevel(10)), 10);
  assert.equal(levelFor(xpForLevel(10) - 1), 9);
});

test('day buckets split work across midnight and count unreviewed earnings at the rate', () => {
  const s = ledger();
  const e = manual(s, 'p0', at('2026-03-02', 22), at('2026-03-03', 2)); s.entries.push(e);
  validate(s);
  const {days, extra} = dayBuckets(s, at('2026-03-04', 12));
  assert.equal(days.get('2026-03-02').unique, 2 * HOUR);
  assert.equal(days.get('2026-03-03').unique, 2 * HOUR);
  assert.deepEqual(days.get('2026-03-02').earned, {GBP: 12000});
  assert.deepEqual(days.get('2026-03-02').money, {}, 'unreviewed work is not official money');
  assert.ok(extra.night);
  // Reviewed as non-billable: no play earnings either.
  Object.assign(e, {approved: 4 * HOUR, billable: false});
  assert.deepEqual(dayBuckets(s, at('2026-03-04', 12)).days.get('2026-03-02').earned, {});
});

test('streaks skip rest weekends and respect the goal rule', () => {
  const s = ledger();
  // Thu 5 – Fri 6 Mar, weekend off, Mon 9 – Tue 10 Mar 2026.
  for (const d of ['2026-03-05', '2026-03-06', '2026-03-09', '2026-03-10']) work(s, 'p0', d, 9, 2);
  validate(s);
  const now = at('2026-03-11', 8); // Wednesday morning, nothing logged yet
  let st = streaks(s, dayBuckets(s, now).days, now);
  assert.equal(st.current, 4);
  assert.equal(st.todayDone, false);
  s.settings.restWeekends = false;
  st = streaks(s, dayBuckets(s, now).days, now);
  assert.equal(st.current, 2);
  assert.equal(st.best, 2);
  s.settings.restWeekends = true; s.settings.streak = 'goal';
  saveGoal(s, 'day', at('2026-03-01', 12), 3, null, 'defaults');
  assert.equal(streaks(s, dayBuckets(s, now).days, now).current, 0, 'two hours misses a three-hour goal');
});

test('XP, goal hits and achievements derive from the ledger', () => {
  const s = ledger();
  saveGoal(s, 'day', at('2026-03-01', 12), 8, null, 'defaults');
  const e = work(s, 'p0', '2026-03-02', 6, 10); Object.assign(e, {kind: 'timer', focus: [[at('2026-03-02', 6), at('2026-03-02', 9)]]});
  work(s, 'p1', '2026-03-03', 9, 1);
  validate(s);
  const g = play(s, at('2026-03-04', 12));
  assert.equal(g.stats.goals.day, 1);
  const ids = g.achievements.filter(a => a.unlocked).map(a => a.id);
  for (const id of ['first-hour', 'marathon', 'deep-work', 'day-goal', 'early-bird']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('globetrotter'));
  // 11h ×10 + 3h focus ×5 + earnings (£600 + $60 = €800 → 80) + day goal 50 + 5 achievements ×100
  assert.equal(g.xp, 110 + 15 + 80 + 50 + 100 * ids.length);
  assert.equal(g.level, levelFor(g.xp));
  // Same ledger, other goal currency: XP does not change.
  const usd = structuredClone(s); usd.settings.currency = 'USD';
  assert.equal(play(usd, at('2026-03-04', 12)).xp, g.xp);
});

test('goal results combine currencies and report the bottleneck', () => {
  const s = ledger();
  const a = work(s, 'p0', '2026-03-02', 9, 4), b = work(s, 'p1', '2026-03-02', 14, 2);
  for (const e of [a, b]) Object.assign(e, {billable: true, approved: e.end - e.start});
  saveGoal(s, 'day', at('2026-03-02', 12), 5, 30000, 'overrides');
  validate(s);
  const {days} = dayBuckets(s, at('2026-03-03', 9));
  const r = goalResult(s, days, 'day', at('2026-03-02', 12));
  assert.equal(r.money, 24000 + 8000); // £240 + $120 (= £80)
  assert.equal(r.hours, 6 * HOUR);
  assert.ok(r.hit);
  assert.equal(totals(s, days, [at('2026-03-02', 0), at('2026-03-03', 0)]).days, 1);
});

test('live earnings, pace and client targets', () => {
  const s = ledger();
  timer(s, 'start', 'p1', at('2026-03-04', 9));
  validate(s);
  const lv = live(s, at('2026-03-04', 9.5));
  assert.equal(lv.per[s.entries[0].id], 3000);
  assert.equal(lv.total, 2000); // $30 → £20
  // Wednesday 13:00 of a Mon-start week: 2 days + half of today elapsed out of 5.
  s.settings.weekStart = 1;
  const p = pace(s, 'week', at('2026-03-04', 13), 25 * HOUR, 40 * HOUR);
  assert.equal(p.workDays, 5);
  assert.equal(p.forecast, 50 * HOUR);
  s.targets.push({id: 't1', kind: 'company', owner: 'c1', period: 'week', hours: 10, money: null});
  validate(s);
  const t = targetProgress(s, s.targets[0], at('2026-03-04', 11));
  assert.equal(t.hours, 2 * HOUR);
  assert.equal(t.money, 12000);
  assert.equal(t.currency, 'USD');
  assert.throws(() => validate({...structuredClone(s), targets: [{id: 't2', kind: 'company', owner: 'nope', period: 'week', hours: 1, money: null}]}), /target/);
});

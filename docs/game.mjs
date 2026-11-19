// Game layer. Everything here is derived from the ledger, so XP, streaks and achievements are
// identical on every synced device and survive backups, merges and currency changes.
import * as C from './core.mjs';
const DAY = 86400000;

// Earnings for play: reviewed work uses its approved billable amount; unreviewed work counts
// at its recorded rate so progress moves while you work.
export function earned(e, a) {
  if (e.approved !== null) return e.billable ? a.amount : 0;
  return e.rate === null ? 0 : Math.round(e.rate * a.logged / C.HOUR);
}
const isWeekend = key => [0, 6].includes(C.localDate(key).getDay());
const addMoney = (map, cc, v) => { if (v) map[cc] = (map[cc] ?? 0) + v; };

// Per local day: unique, logged and approved time, focus, official money and play earnings.
export function dayBuckets(s, now) {
  const days = new Map(), extra = {early: false, night: false, longestFocus: 0};
  const day = key => days.get(key) ?? days.set(key, {key, seg: [], logged: 0, approved: 0, focus: 0, money: {}, earned: {}}).get(key);
  for (const e of s.entries) {
    const stop = e.end ?? now;
    for (const [a, b] of e.focus) extra.longestFocus = Math.max(extra.longestFocus, (b ?? now) - a);
    for (let r = C.periodRange('day', e.start); r[0] < stop; r = C.periodRange('day', r[1])) {
      const a = C.entryStats(e, r, now);
      if (!a.logged) continue;
      const d = day(C.keyDate(r[0]));
      d.seg.push(...a.seg); d.logged += a.logged; d.approved += a.approved ?? 0; d.focus += a.focus;
      if (e.billable && e.approved !== null) addMoney(d.money, e.currency, a.amount);
      addMoney(d.earned, e.currency, earned(e, a));
      for (const [x, y] of a.seg) {
        if (new Date(x).getHours() < 7) extra.early = true;
        if (new Date(y - 1).getHours() >= 22) extra.night = true;
      }
    }
  }
  for (const d of days.values()) d.unique = C.lengthOf(C.union(d.seg));
  return {days, extra};
}

// Totals for a date range from day buckets, with money in the goal currency.
export function totals(s, days, range) {
  const from = C.keyDate(range[0]), to = C.keyDate(range[1] - 1), fx = s.settings.fx, cc = s.settings.currency;
  const out = {unique: 0, logged: 0, approved: 0, focus: 0, money: {}, earned: {}, days: 0};
  for (const d of days.values()) {
    if (d.key < from || d.key > to) continue;
    out.unique += d.unique; out.logged += d.logged; out.approved += d.approved; out.focus += d.focus; out.days++;
    for (const [k, v] of Object.entries(d.money)) addMoney(out.money, k, v);
    for (const [k, v] of Object.entries(d.earned)) addMoney(out.earned, k, v);
  }
  out.moneyTotal = C.totalIn(out.money, cc, fx); out.earnedTotal = C.totalIn(out.earned, cc, fx);
  return out;
}

// Progress against the personal goal for the period containing `at`. Null when no target is set.
export function goalResult(s, days, period, at) {
  const g = C.goal(s, period, at);
  if (!g.hours && !g.money) return null;
  const range = C.periodRange(period, at, s.settings.weekStart), t = totals(s, days, range);
  const hours = t[s.settings.basis], parts = [];
  if (g.hours) parts.push(hours / (g.hours * C.HOUR));
  if (g.money) parts.push(t.moneyTotal / g.money);
  const ratio = Math.min(...parts);
  return {goal: g, range, hours, money: t.moneyTotal, ratio, percent: Math.round(ratio * 100), hit: ratio >= 1};
}

function qualifies(s, days, key) {
  const d = days.get(key);
  if (s.settings.streak === 'goal') return !!goalResult(s, days, 'day', +C.localDate(key))?.hit;
  return !!d && d.unique >= 30 * C.MIN;
}
const prevKey = key => { const d = C.localDate(key); d.setDate(d.getDate() - 1); return C.keyDate(d); };
const nextKey = key => { const d = C.localDate(key); d.setDate(d.getDate() + 1); return C.keyDate(d); };

export function streaks(s, days, now) {
  const rest = s.settings.restWeekends, today = C.keyDate(now);
  let current = 0, key = today;
  if (!qualifies(s, days, key)) key = prevKey(key); // today is still in progress
  for (let guard = 0; guard < 5000; guard++, key = prevKey(key)) {
    if (qualifies(s, days, key)) current++;
    else if (!(rest && isWeekend(key))) break;
  }
  let best = 0, run = 0;
  const keys = [...days.keys()].sort();
  if (keys.length) for (let k = keys[0]; k <= today; k = nextKey(k)) {
    if (qualifies(s, days, k)) best = Math.max(best, ++run);
    else if (!(rest && isWeekend(k))) run = 0;
  }
  return {current, best: Math.max(best, current), todayDone: qualifies(s, days, today)};
}

export const levelFor = xp => Math.max(1, Math.floor((1 + Math.sqrt(1 + xp / 12.5)) / 2));
export const xpForLevel = level => 50 * level * (level - 1);
const ranks = ['Rookie', 'Apprentice', 'Journeyman', 'Artisan', 'Expert', 'Master', 'Grandmaster', 'Legend'];
export const rankFor = level => ranks[Math.min(ranks.length - 1, Math.floor((level - 1) / 5))];
export const goalXp = {day: 50, week: 150, month: 500, year: 2000};

const major = (s, v) => v / 100; // all supported currencies have two decimals
export const achievements = [
  ['first-hour', '⏱️', 'Clocked in', 'Log your first hour of work.', st => st.hours >= 1],
  ['hours-100', '💯', 'Century', 'Log 100 hours in total.', st => st.hours >= 100],
  ['hours-500', '🏔️', 'Summit', 'Log 500 hours in total.', st => st.hours >= 500],
  ['hours-1000', '🏆', 'Thousand-hour club', 'Log 1,000 hours in total.', st => st.hours >= 1000],
  ['marathon', '🏃', 'Marathon', 'Work 10 hours in a single day.', st => st.maxDay >= 10],
  ['deep-work', '🎯', 'Deep work', 'Hold focus for 2 hours straight.', st => st.longestFocus >= 2],
  ['focus-week', '🧘', 'In the zone', 'Focus for 15 hours in one week.', st => st.maxWeekFocus >= 15],
  ['day-goal', '✅', 'Daily win', 'Hit a daily goal.', st => st.goals.day >= 1],
  ['week-goal', '📅', 'Week well spent', 'Hit a weekly goal.', st => st.goals.week >= 1],
  ['month-goal', '🌕', 'Monthly milestone', 'Hit a monthly goal.', st => st.goals.month >= 1],
  ['day-goals-20', '🎖️', 'Habit formed', 'Hit 20 daily goals.', st => st.goals.day >= 20],
  ['streak-3', '🔥', 'Warming up', 'Reach a 3-day streak.', st => st.bestStreak >= 3],
  ['streak-7', '⚡', 'On a roll', 'Reach a 7-day streak.', st => st.bestStreak >= 7],
  ['streak-30', '☄️', 'Unstoppable', 'Reach a 30-day streak.', st => st.bestStreak >= 30],
  ['earn-1k-month', '💰', 'Four figures', st => 'Earn ' + st.fmt(100000) + ' in one month.', st => st.maxMonthEarned >= 1000],
  ['earn-10k', '💎', 'Five figures', st => 'Earn ' + st.fmt(1000000) + ' in total.', st => st.totalEarned >= 10000],
  ['earn-100k', '👑', 'Six figures', st => 'Earn ' + st.fmt(10000000) + ' in total.', st => st.totalEarned >= 100000],
  ['paid', '🤑', 'Cha-ching', 'Mark your first entry as paid.', st => st.paid >= 1],
  ['globetrotter', '🌍', 'Globetrotter', 'Earn in 3 different currencies.', st => st.currencies >= 3],
  ['early-bird', '🌅', 'Early bird', 'Start work before 7:00.', st => st.early],
  ['night-owl', '🦉', 'Night owl', 'Work past 22:00.', st => st.night]
].map(([id, icon, name, desc, test]) => ({id, icon, name, desc, test}));

let memo = null;
// The complete game state for the ledger at `now`. Cached per ledger object and minute.
export function play(s, now, fmt = v => (v / 100).toFixed(0)) {
  const stamp = Math.floor(now / C.MIN);
  if (memo && memo.s === s && memo.stamp === stamp) return memo.out;
  const {days, extra} = dayBuckets(s, now), cc = s.settings.currency, fx = s.settings.fx;
  const goals = {day: 0, week: 0, month: 0, year: 0}, seen = new Set();
  const periodTotals = {week: new Map(), month: new Map()};
  let xp = 0, hours = 0, maxDay = 0, totalEarnedEur = 0;
  const currencies = new Set(), allEarned = {};
  for (const d of days.values()) {
    hours += d.unique; maxDay = Math.max(maxDay, d.unique);
    const eur = C.totalIn(d.earned, 'EUR', fx); totalEarnedEur += eur;
    for (const [k, v] of Object.entries(d.earned)) { addMoney(allEarned, k, v); if (v > 0) currencies.add(k); }
    xp += 10 * d.unique / C.HOUR + 5 * d.focus / C.HOUR + eur / 1000;
    const at = +C.localDate(d.key);
    for (const period of C.periods) {
      const key = period + C.keyDate(C.periodRange(period, at, s.settings.weekStart)[0]);
      if (seen.has(key)) continue; seen.add(key);
      if (goalResult(s, days, period, at)?.hit) { goals[period]++; xp += goalXp[period]; }
      if (period === 'week' || period === 'month') periodTotals[period].set(key, totals(s, days, C.periodRange(period, at, s.settings.weekStart)));
    }
  }
  const streak = streaks(s, days, now);
  const stats = {
    hours: hours / C.HOUR, maxDay: maxDay / C.HOUR, longestFocus: extra.longestFocus / C.HOUR, early: extra.early, night: extra.night,
    maxWeekFocus: Math.max(0, ...[...periodTotals.week.values()].map(t => t.focus / C.HOUR)),
    maxMonthEarned: major(s, Math.max(0, ...[...periodTotals.month.values()].map(t => t.earnedTotal))),
    totalEarned: major(s, C.totalIn(allEarned, cc, fx)), currencies: currencies.size,
    paid: s.entries.filter(e => e.status === 'Paid').length, goals, bestStreak: streak.best, fmt
  };
  const list = achievements.map(a => ({...a, desc: typeof a.desc === 'function' ? a.desc(stats) : a.desc, unlocked: !!a.test(stats)}));
  xp = Math.round(xp + 100 * list.filter(a => a.unlocked).length);
  const level = levelFor(xp);
  const out = {days, xp, level, rank: rankFor(level), floor: xpForLevel(level), next: xpForLevel(level + 1), streak, stats, achievements: list};
  memo = {s, stamp, out};
  return out;
}

// Earnings from timers that are running right now, in the goal currency.
export function live(s, now) {
  const fx = s.settings.fx, cc = s.settings.currency, per = {};
  for (const e of s.entries) if (e.end === null && e.rate !== null) {
    const ms = C.lengthOf(C.clip(e.segments, [-Infinity, Infinity], now));
    per[e.id] = Math.round(e.rate * ms / C.HOUR);
  }
  const total = Object.entries(per).reduce((n, [id, v]) => n + C.convert(v, C.byId(s.entries, id).currency, cc, fx), 0);
  return {per, total};
}

// Working days in [from, to): weekdays, or every day when weekends are not rest days.
export function workDays(s, from, to) {
  let n = 0;
  for (let d = new Date(from); +d < to; d.setDate(d.getDate() + 1)) if (!s.settings.restWeekends || ![0, 6].includes(d.getDay())) n++;
  return n;
}
// Where the period will land at the current pace, and what is needed per remaining work day.
export function pace(s, period, at, actual, target) {
  const [start, end] = C.periodRange(period, at, s.settings.weekStart), today = C.periodRange('day', at);
  const total = workDays(s, start, end), before = workDays(s, start, today[0]), todayWork = workDays(s, today[0], today[1]);
  const hour = (at - today[0]) / C.HOUR, fraction = todayWork * Math.min(1, Math.max(0, (hour - 9) / 8));
  const elapsed = before + fraction, remaining = Math.max(0, total - elapsed);
  const forecast = elapsed > 0.25 ? Math.round(actual / elapsed * total) : null;
  return {forecast, perDay: target && remaining > 0 ? Math.max(0, (target - actual) / Math.max(remaining, todayWork ? 1 - fraction : 1)) : null, workDays: total, remaining};
}

// Progress for a company or project target in its current period.
export function targetProgress(s, t, now) {
  const range = C.periodRange(t.period, now, s.settings.weekStart);
  const entries = s.entries.filter(e => t.kind === 'company' ? e.companyId === t.owner : e.projectId === t.owner);
  const cc = t.kind === 'company' ? C.byId(s.companies, t.owner)?.currency : C.byId(s.companies, C.byId(s.projects, t.owner)?.companyId)?.currency;
  let seg = [], amount = 0;
  for (const e of entries) {
    const a = C.entryStats(e, range, now);
    seg.push(...a.seg); amount += C.convert(earned(e, a), e.currency, cc, s.settings.fx);
  }
  return {range, hours: C.lengthOf(C.union(seg)), money: amount, currency: cc};
}

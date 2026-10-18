// MassPermits: the pure rules behind the Road to 20 page (GET /admin/api/growth).
// The page is titled "Road to 20" while paying is under 20, then "Road to 100".
//
// No I/O in this file. The route reads R2 and Stripe, hands plain values in,
// and gets back a payload of COUNTS ONLY: no email, no name, no Stripe id, no
// card detail, no page path, no town. Every rule the owner reads a number by
// lives here, so the tests drive each one directly.
//
// WEEKS. A week is Monday 00:00 to the next Monday 00:00 in America/New_York,
// the owner's clock, so a Sunday 11pm checkout in Boston is Sunday's week even
// though it is already Monday in UTC. The page shows this week so far plus
// the 12 weeks before it.
//
// A CELL is a number, or one of the fixed words in WORDS. A number that is
// only a floor (a list that was cut short, a week the data starts inside) is
// named in that week's "at_least" list. Unknown is never shown as 0.

export const TZ = "America/New_York";
export const WEEKS = 13;
// The owner's milestones, in order: the next 10 paying, then 20 by the
// deadline below, then 100 as the long-run goal.
export const MILESTONES = Object.freeze([10, 20, 100]);
export const DEADLINES = Object.freeze({ 20: "2026-12-31" });
export const DAY_MS = 86400000;
export const WEEK_MS = 7 * DAY_MS;
// A checkout still open MORE than this long after it was opened counts as
// abandoned (the owner's rule: "open for over 24 hours").
export const OPEN_LIMIT_MS = 24 * 3600000;
// A percentage is printed only from this many; below it, only "x of y".
// Same rule as the funnel snapshot (functions/api/funnel.js).
export const RATE_MIN = 20;
// The Weekly Feed payment link (the public buy.stripe.com path, printed on the
// homepage and the offer pages). A click on any other buy link counts as
// "other" (the Lead Pack, the agents Radar).
export const FEED_LINKS = new Set(["dRmdR80Ms8WzctM9ZJ4gg01"]);
// Clicks on the /offer page's buttons, which that page logs as page views so
// the /ops counts stay as they were (changing that is the owner's call). They
// are not visits, so they are left out of the visit count here.
export const OLD_OFFER_CLICK_PATH = "/offer/click";

export const WORDS = Object.freeze({
  unavailable: "unavailable",
  notConnected: "not connected",
  refused: "key refused",
  noData: "no data yet",
  notTracked: "not tracked yet",
});

// Paying at a moment: these three statuses, per the owner's definition.
const PAYING = new Set(["active", "trialing", "past_due"]);
// Never counted in any week: never paid, or stopped paying at a moment Stripe
// does not give us (unpaid and paused carry no timestamp for the change).
const NEVER_COUNTED = new Set(["incomplete", "incomplete_expired", "unpaid", "paused"]);

// ── milestones ──────────────────────────────────────────────────────────────
// The first milestone above `paying`, how many to go, and its deadline if it
// has one. At or past the last milestone: that one, 0 to go, reached.
export function nextMilestone(paying) {
  if (typeof paying !== "number" || !Number.isFinite(paying)) return null;
  const last = MILESTONES[MILESTONES.length - 1];
  const target = MILESTONES.find((m) => paying < m) || last;
  return { target, to_go: Math.max(0, target - paying), deadline: DEADLINES[target] || null, reached: paying >= last };
}

// The page title: "Road to 20" while paying is under 20 (or not known), then 100.
export function roadOf(paying) {
  return typeof paying === "number" && paying >= 20 ? 100 : 20;
}

// ── checkout source ─────────────────────────────────────────────────────────
// Where a paid checkout came from, from its client_reference_id, as one of
// SOURCES. Only the bucket leaves the Stripe reader; the raw value is dropped.
// The formats in use today (index.html, refCode() and stripeWith()):
//   "ref-<4 to 24 lowercase letters or digits>"  a referral (the mp_ref cookie
//                                                  set by /r/<code>, or ?ref=)
//   "<trade>__<area>"  the homepage trade and area picker, each part "all" when
//                      nothing is picked, anything else in it replaced by "-"
// RESERVED: "ps-<lowercase letters, digits or ->" is kept for future prospect
// sample links. Nothing writes it yet; a sample link that adds it is counted
// as "prospect_sample" here without any change to this file.
// Anything else, or none (a buy link without the picker), is "unknown".
export const SOURCES = Object.freeze(["referral", "picker", "prospect_sample", "unknown"]);
const REF_SHAPE = /^ref-[a-z0-9]{4,24}$/;
const PS_SHAPE = /^ps-[a-z0-9][a-z0-9-]{0,39}$/;
const PICKER_SHAPE = /^[A-Za-z0-9-]{1,80}__[A-Za-z0-9_-]{1,80}$/;

export function sourceOf(ref) {
  if (typeof ref !== "string") return "unknown";
  if (REF_SHAPE.test(ref)) return "referral";
  if (PS_SHAPE.test(ref)) return "prospect_sample";
  if (PICKER_SHAPE.test(ref)) return "picker";
  return "unknown";
}

// ── clock ───────────────────────────────────────────────────────────────────
const FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
  hour: "numeric", minute: "numeric", second: "numeric",
});

export function localParts(ms) {
  const o = {};
  for (const p of FMT.formatToParts(new Date(ms))) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: (+o.hour) % 24, mi: +o.minute, s: +o.second };
}

// New York time minus UTC, in ms, at an instant (minus 4 or 5 hours).
function offsetAt(ms) {
  const p = localParts(ms);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

// The UTC instant of 00:00 New York time on a calendar date. Twice, so a date
// on either side of a clock change settles on its own offset.
export function localMidnight(y, m, d) {
  const base = Date.UTC(y, m - 1, d);
  let t = base - offsetAt(base);
  t = base - offsetAt(t);
  return t;
}

function ymd(dateMs) {
  return new Date(dateMs).toISOString().slice(0, 10);
}

function midnightOf(dateMs) {
  const d = new Date(dateMs);
  return localMidnight(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

// The WEEKS weeks ending with the one that holds `now`, oldest first, plus the
// week before them (`before`, for differences). Each week: its Monday and
// Sunday as dates, and its start and end as UTC instants.
export function weekGrid(now) {
  const p = localParts(now);
  const today = Date.UTC(p.y, p.m - 1, p.d);          // the calendar date, as a UTC stand-in
  const monday = today - ((new Date(today).getUTCDay() + 6) % 7) * DAY_MS;
  const make = (mon) => ({
    week: ymd(mon),
    last_day: ymd(mon + 6 * DAY_MS),
    start: midnightOf(mon),
    end: midnightOf(mon + 7 * DAY_MS),
  });
  const weeks = [];
  for (let i = WEEKS - 1; i >= 0; i--) weeks.push(make(monday - i * WEEK_MS));
  weeks[weeks.length - 1].current = true;
  return { weeks, before: make(monday - WEEKS * WEEK_MS), start: weeks[0].start, now };
}

export function weekIndex(grid, ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return -1;
  const w = grid.weeks;
  for (let i = 0; i < w.length; i++) if (ms >= w[i].start && ms < w[i].end) return i;
  return -1;
}

// ── checkouts ───────────────────────────────────────────────────────────────
// Statuses are the projection's (_growth_stripe.js). "paid": completed and
// charged. "abandoned": expired, or still open more than 24 hours after it was
// opened, and the same buyer did not complete another checkout in the window.
// "in_progress": open and not older than that. "other": everything else, such
// as a checkout completed with nothing charged (a 100% coupon or a trial), or
// one the buyer replaced with a checkout they completed ("superseded").
export function classifySession(s, now) {
  if (!s) return "other";
  if (s.status === "complete") return "paid";
  if (s.status === "expired") return "abandoned";
  if (s.status === "open") {
    const opened = typeof s.created === "number" ? s.created * 1000 : null;
    if (opened === null) return "other";
    return now - opened > OPEN_LIMIT_MS ? "abandoned" : "in_progress";
  }
  return "other";
}

// ── subscribers ─────────────────────────────────────────────────────────────
// When a subscription stops paying, in seconds: Stripe's ended_at, or, for one
// still in a paying status that is set to cancel ("leaving"), its scheduled
// end once that is at or before `t`. A scheduled end still ahead is not an end.
function endOf(s, t) {
  if (typeof s.ended === "number") return s.ended;
  if (s.leaving === true && PAYING.has(s.status) && typeof s.leaving_at === "number" && s.leaving_at * 1000 <= t) return s.leaving_at;
  return null;
}

const counted = (s) => s && typeof s.start === "number" && !NEVER_COUNTED.has(s.status);

// Paying at instant t: started at or before t, not ended at or before t, and
// not a status that is never counted. A subscription that has not ended must
// be in a paying status now.
export function payingAt(subs, t) {
  let n = 0;
  for (const s of subs || []) {
    if (!counted(s)) continue;
    if (s.start * 1000 > t) continue;
    const end = endOf(s, t);
    if (end !== null) {
      if (end * 1000 <= t) continue;
    } else if (!PAYING.has(s.status)) {
      continue;
    }
    n++;
  }
  return n;
}

// Paying at `now` and set to cancel at a later moment: the "leaving" ones.
// Each end as a New York calendar date ("unknown" when Stripe gave none).
export function leavingAt(subs, now) {
  const dates = new Map();
  let n = 0;
  for (const s of subs || []) {
    if (!counted(s) || s.start * 1000 > now || !PAYING.has(s.status) || s.leaving !== true) continue;
    if (endOf(s, now) !== null) continue;
    n++;
    let date = "unknown";
    if (typeof s.leaving_at === "number") {
      const p = localParts(s.leaving_at * 1000);
      date = ymd(Date.UTC(p.y, p.m - 1, p.d));
    }
    dates.set(date, (dates.get(date) || 0) + 1);
  }
  const ends = [...dates].map(([date, k]) => ({ date, n: k }))
    .sort((a, b) => (a.date === "unknown") - (b.date === "unknown") || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { n, ends };
}

// Started and ended inside [start, end), counting only up to `upTo` (the
// current week stops at now). Same instants as payingAt, so a week's change
// in paying is exactly new minus ended.
export function flowIn(subs, start, end, upTo) {
  let started = 0, ended = 0;
  const stop = Math.min(end, upTo + 1);
  for (const s of subs || []) {
    if (!counted(s)) continue;
    const a = s.start * 1000;
    if (a >= start && a < stop) started++;
    const e = endOf(s, upTo);
    if (e !== null && e * 1000 >= start && e * 1000 < stop && e >= s.start) ended++;
  }
  return { started, ended };
}

// ── free sign ups (funnel-metrics.json, newest first, one per day) ──────────
// Only numbers leave: when, the digest list size, confirmed readers, sample
// requests. The snapshot's town and trade tallies are never read.
export function parseFunnel(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const s of list) {
    if (!s || typeof s !== "object") continue;
    const at = Date.parse(s.at);
    const nl = s.newsletter && typeof s.newsletter === "object" ? s.newsletter : {};
    const pr = s.prospects && typeof s.prospects === "object" ? s.prospects : {};
    const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    if (!Number.isFinite(at) || n(nl.total) === null || n(pr.total) === null) continue;
    out.push({ at, total: nl.total + pr.total, readers: n(nl.confirmed), samples: pr.total });
  }
  return out.sort((a, b) => a.at - b.at);
}

// The last snapshot taken inside [start, end).
function lastIn(snaps, start, end) {
  let hit = null;
  for (const s of snaps) if (s.at >= start && s.at < end) hit = s;
  return hit;
}

// ── rates ───────────────────────────────────────────────────────────────────
export function rate(n, d) {
  if (typeof n !== "number" || typeof d !== "number") return null;
  return { n, d, pct: d >= RATE_MIN && d > 0 ? Math.round((100 * n) / d) : null };
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

// Sums over the given weeks, only where BOTH sides are numbers in that week,
// so a week with no click data never divides against its checkouts.
function pairRate(weeks, num, den) {
  let n = 0, d = 0, used = 0;
  for (const w of weeks) {
    if (!isNum(w[num]) || !isNum(w[den])) continue;
    n += w[num];
    d += w[den];
    used++;
  }
  return used ? { ...rate(n, d), weeks: used } : null;
}

const STEPS = [
  ["visit_to_click", "buy_clicks", "visits"],
  ["click_to_checkout", "checkouts", "buy_clicks"],
  ["checkout_to_paid", "paid", "checkouts"],
  ["checkout_abandoned", "abandoned", "checkouts"],
  ["visit_to_paid", "paid", "visits"],
];

// A total over some weeks: the sum of the weeks that have a number, how many
// weeks that was, and whether it is only a floor (any summed week was). With
// no number in any week, the total is that key's word, "unavailable" first,
// so a source that failed never reads as a counter that had not started.
function sumOf(weeks, key) {
  let s = 0, used = 0, floor = false, word = null;
  for (const w of weeks) {
    const v = w[key];
    if (isNum(v)) {
      s += v;
      used++;
      if (Array.isArray(w.at_least) && w.at_least.includes(key)) floor = true;
    } else if (typeof v === "string" && (word === null || v === WORDS.unavailable)) {
      word = v;
    }
  }
  if (used) return { value: s, used, floor };
  return { value: word === null ? WORDS.unavailable : word, used: 0, floor: false };
}

function funnelOf(weeks) {
  const totals = {}, covered = {}, atLeast = [];
  for (const k of ["visits", "buy_clicks", "checkouts", "abandoned", "paid", "free_signups"]) {
    const t = sumOf(weeks, k);
    totals[k] = t.value;
    covered[k] = t.used;
    if (t.floor) atLeast.push(k);
  }
  const rates = {};
  for (const [name, num, den] of STEPS) rates[name] = pairRate(weeks, num, den);
  return { weeks: weeks.length, totals, covered, at_least: atLeast, rates };
}

// ── the payload ─────────────────────────────────────────────────────────────
function stripeWord(state) {
  if (state === "not-connected") return WORDS.notConnected;
  if (state === "refused") return WORDS.refused;
  return WORDS.unavailable;
}

function flag(w, key) {
  if (!w.at_least.includes(key)) w.at_least.push(key);
}

// First-party counts (visits or clicks) into the weeks.
//   src: { state: "ok"|"partial"|"unreadable", first: ms|null, through: ms|null,
//          ts: [ms...] }                       (through: where a cut-short scan stopped)
function placeFirstParty(grid, rows, key, src, beforeWord) {
  const counts = new Array(rows.length).fill(0);
  if (src && src.state !== "unreadable") {
    for (const t of src.ts || []) {
      const i = weekIndex(grid, t);
      if (i >= 0) counts[i]++;
    }
  }
  rows.forEach((w, i) => {
    const g = grid.weeks[i];
    if (!src || src.state === "unreadable") { w[key] = WORDS.unavailable; return; }
    if (src.first === null || src.first === undefined || g.end <= src.first) { w[key] = beforeWord; return; }
    w[key] = counts[i];
    if (g.start < src.first) flag(w, key);
    if (src.state === "partial" && (src.through === null || src.through === undefined || g.end > src.through)) flag(w, key);
  });
}

// buildGrowth({ now, grid, visits, clicks, stripe, funnel })
//   visits: first-party page loads, as placeFirstParty's src
//   clicks: { state, first, through, feed: [ms], other: [ms] }
//   stripe: _growth_stripe.js growthStripe() result
//   funnel: { state: "ok"|"absent"|"unreadable", snaps: parseFunnel() result }
export function buildGrowth({ now, grid, visits, clicks, stripe, funnel }) {
  const rows = grid.weeks.map((g) => ({
    week: g.week, last_day: g.last_day, current: g.current === true, at_least: [],
  }));

  placeFirstParty(grid, rows, "visits", visits, WORDS.noData);
  placeFirstParty(grid, rows, "buy_clicks", clicks && { ...clicks, ts: clicks.feed }, WORDS.notTracked);
  placeFirstParty(grid, rows, "other_buy_clicks", clicks && { ...clicks, ts: clicks.other }, WORDS.notTracked);

  // Stripe: checkouts by the week they were opened; subscribers at week end.
  const st = stripe && stripe.state;
  const sess = stripe && stripe.sessions;
  const subs = stripe && stripe.subscriptions;
  const sessOk = sess && (sess.state === "ok" || sess.state === "partial");
  const subsOk = subs && (subs.state === "ok" || subs.state === "partial");
  const per = rows.map(() => ({ checkouts: 0, abandoned: 0, paid: 0, in_progress: 0 }));
  const bySource = rows.map(() => Object.fromEntries(SOURCES.map((k) => [k, 0])));
  if (sessOk) {
    for (const s of sess.items || []) {
      const i = weekIndex(grid, typeof s.created === "number" ? s.created * 1000 : NaN);
      if (i < 0) continue;
      per[i].checkouts++;
      const c = classifySession(s, now);
      if (c === "paid" || c === "abandoned" || c === "in_progress") per[i][c]++;
      if (c === "paid") bySource[i][SOURCES.includes(s.source) ? s.source : "unknown"]++;
    }
  }
  rows.forEach((w, i) => {
    const g = grid.weeks[i];
    if (!sessOk) {
      const word = sess ? WORDS.unavailable : stripeWord(st);
      for (const k of ["checkouts", "abandoned", "paid", "in_progress"]) w[k] = word;
      w.paid_by_source = word;
    } else {
      Object.assign(w, per[i]);
      w.paid_by_source = bySource[i];
      if (sess.state === "partial" && (typeof sess.complete_from !== "number" || g.start < sess.complete_from)) {
        for (const k of ["checkouts", "abandoned", "paid", "in_progress", "paid_by_source"]) flag(w, k);
      }
    }
    if (!subsOk) {
      const word = subs ? WORDS.unavailable : stripeWord(st);
      for (const k of ["subscribers", "new_paid", "ended", "net"]) w[k] = word;
    } else {
      // A past week is measured at its last instant (end minus 1 ms): g.end is
      // already the first instant of the next week, as weekIndex has it.
      const at = g.current ? now : g.end - 1;
      w.subscribers = payingAt(subs.items, at);
      const f = flowIn(subs.items, g.start, g.end, at);
      w.new_paid = f.started;
      w.ended = f.ended;
      w.net = f.started - f.ended;
      if (subs.state === "partial") for (const k of ["subscribers", "new_paid", "ended", "net"]) flag(w, k);
    }
  });

  // Free sign ups: the change in (digest list + sample requests) between the
  // last snapshot of the week before and the last snapshot of this week.
  const fstate = funnel ? funnel.state : "absent";
  const snaps = (funnel && funnel.snaps) || [];
  rows.forEach((w, i) => {
    const g = grid.weeks[i];
    const prev = i === 0 ? grid.before : grid.weeks[i - 1];
    if (fstate === "unreadable") {
      w.free_signups = WORDS.unavailable;
      w.free_readers = WORDS.unavailable;
      return;
    }
    const end = lastIn(snaps, g.start, g.current ? now + 1 : g.end);
    const startSnap = lastIn(snaps, prev.start, prev.end);
    w.free_signups = end && startSnap ? end.total - startSnap.total : WORDS.noData;
    w.free_readers = end && isNum(end.readers) ? end.readers : WORDS.noData;
  });

  const current = rows[rows.length - 1];
  const paying = typeof current.subscribers === "number" ? current.subscribers : null;
  const full = rows.slice(0, -1);
  const next = nextMilestone(paying);
  let retention;
  if (subsOk && paying !== null) {
    const l = leavingAt(subs.items, now);
    retention = { state: "ok", at_least: subs.state === "partial", paying_now: paying, leaving: l.n,
      paying_after: paying - l.n, ends: l.ends };
  } else {
    retention = { state: paying === null ? current.subscribers : WORDS.unavailable };
  }
  const sourceTotals = Object.fromEntries(SOURCES.map((k) => [k, 0]));
  for (const w of rows) if (w.paid_by_source && typeof w.paid_by_source === "object") for (const k of SOURCES) sourceTotals[k] += w.paid_by_source[k];
  const dataStart = (src) => {
    if (!src || typeof src.first !== "number") return null;
    const p = localParts(src.first);
    return ymd(Date.UTC(p.y, p.m - 1, p.d));
  };

  return {
    as_of: new Date(now).toISOString(),
    timezone: TZ,
    // goal: the next milestone (the headline reads "<paying> of <goal>").
    goal: next ? next.target : MILESTONES[0],
    milestones: MILESTONES.slice(),
    next_milestone: next,
    road: roadOf(paying),
    paying_now: paying,
    paying_at_least: paying !== null && current.at_least.includes("subscribers"),
    paying_state: paying === null ? current.subscribers : "ok",
    sources: {
      stripe: {
        state: st || "unavailable",
        scope: stripe && stripe.scope ? stripe.scope : null,
        reason: stripe && typeof stripe.reason === "string" ? stripe.reason : "",
      },
      visits: { state: visits ? visits.state : "unreadable", data_starts: dataStart(visits),
        old_offer_clicks_left_out: visits && isNum(visits.old_clicks) ? visits.old_clicks : 0 },
      clicks: { state: clicks ? clicks.state : "unreadable", data_starts: dataStart(clicks) },
      free: { state: fstate },
    },
    weeks: rows,
    retention,
    sources_paid: sessOk ? { state: "ok", at_least: sess.state === "partial", totals: sourceTotals }
      : { state: sess ? WORDS.unavailable : stripeWord(st) },
    funnel: {
      this_week: funnelOf([current]),
      last_4_weeks: funnelOf(full.slice(-4)),
      all_weeks: funnelOf(rows),
    },
  };
}

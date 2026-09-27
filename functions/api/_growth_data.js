// MassPermits: the pure rules behind the Road to 100 page (GET /admin/api/growth).
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
export const GOAL = 100;
export const DAY_MS = 86400000;
export const WEEK_MS = 7 * DAY_MS;
// A checkout still open this long after it was opened counts as abandoned.
export const OPEN_LIMIT_MS = 24 * 3600000;
// A percentage is printed only from this many; below it, only "x of y".
// Same rule as the funnel snapshot (functions/api/funnel.js).
export const RATE_MIN = 20;
// The Weekly Feed payment link (the public buy.stripe.com path, printed on the
// homepage and the offer pages). A click on any other buy link counts as
// "other" (the Lead Pack, the agents Radar).
export const FEED_LINKS = new Set(["dRmdR80Ms8WzctM9ZJ4gg01"]);
// Clicks the /offer page logged as page views before buy clicks had their own
// event. They are not visits, so they are left out of the visit count.
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
// "paid": completed. "abandoned": expired, or still open 24 hours after it
// was opened. "in_progress": open and younger than that.
export function classifySession(s, now) {
  if (!s) return "other";
  if (s.status === "complete") return "paid";
  if (s.status === "expired") return "abandoned";
  if (s.status === "open") {
    const opened = typeof s.created === "number" ? s.created * 1000 : null;
    if (opened === null) return "other";
    return now - opened >= OPEN_LIMIT_MS ? "abandoned" : "in_progress";
  }
  return "other";
}

// ── subscribers ─────────────────────────────────────────────────────────────
// Paying at instant t: started at or before t, not ended at or before t, and
// not a status that is never counted. A subscription that has not ended must
// be in a paying status now.
export function payingAt(subs, t) {
  let n = 0;
  for (const s of subs || []) {
    if (!s || typeof s.start !== "number" || NEVER_COUNTED.has(s.status)) continue;
    if (s.start * 1000 > t) continue;
    if (typeof s.ended === "number") {
      if (s.ended * 1000 <= t) continue;
    } else if (!PAYING.has(s.status)) {
      continue;
    }
    n++;
  }
  return n;
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

function sumOf(weeks, key) {
  let s = 0, used = 0;
  for (const w of weeks) if (isNum(w[key])) { s += w[key]; used++; }
  return used ? s : null;
}

function funnelOf(weeks) {
  const totals = {};
  for (const k of ["visits", "buy_clicks", "checkouts", "abandoned", "paid", "free_signups"]) totals[k] = sumOf(weeks, k);
  const rates = {};
  for (const [name, num, den] of STEPS) rates[name] = pairRate(weeks, num, den);
  return { weeks: weeks.length, totals, rates };
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
  if (sessOk) {
    for (const s of sess.items || []) {
      const i = weekIndex(grid, typeof s.created === "number" ? s.created * 1000 : NaN);
      if (i < 0) continue;
      per[i].checkouts++;
      const c = classifySession(s, now);
      if (c === "paid" || c === "abandoned" || c === "in_progress") per[i][c]++;
    }
  }
  rows.forEach((w, i) => {
    const g = grid.weeks[i];
    if (!sessOk) {
      const word = sess ? WORDS.unavailable : stripeWord(st);
      for (const k of ["checkouts", "abandoned", "paid", "in_progress"]) w[k] = word;
    } else {
      Object.assign(w, per[i]);
      if (sess.state === "partial" && (typeof sess.complete_from !== "number" || g.start < sess.complete_from)) {
        for (const k of ["checkouts", "abandoned", "paid", "in_progress"]) flag(w, k);
      }
    }
    if (!subsOk) {
      w.subscribers = subs ? WORDS.unavailable : stripeWord(st);
    } else {
      w.subscribers = payingAt(subs.items, g.current ? now : g.end);
      if (subs.state === "partial") flag(w, "subscribers");
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
  const dataStart = (src) => {
    if (!src || typeof src.first !== "number") return null;
    const p = localParts(src.first);
    return ymd(Date.UTC(p.y, p.m - 1, p.d));
  };

  return {
    as_of: new Date(now).toISOString(),
    timezone: TZ,
    goal: GOAL,
    paying_now: paying,
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
    funnel: {
      this_week: funnelOf([current]),
      last_4_weeks: funnelOf(full.slice(-4)),
      all_weeks: funnelOf(rows),
    },
  };
}

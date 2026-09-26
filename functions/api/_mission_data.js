// MassPermits — Mission Control rules. PURE: no I/O, no clock of its own.
//
// Every function here takes the time as `now` (ms) and already-read data, and
// returns plain objects. The route (functions/admin/api/mission.js) does the
// reads; this file decides what they mean. That split is what lets every
// timing drill, map drill and privacy check run offline against fixtures.
//
// WHAT NEVER LEAVES THIS FILE
//   * engine text: refresh-status error, traceback, contracts and errors{}
//     values; source-health last_error, recent[].err, last_unscored_why. They
//     can carry a property owner's name, which no regex can find. They are
//     read ONLY by errKind() and failKind(), which return fixed codes.
//   * _presend.js evaluate() reasons and headline(): on a failed run they
//     quote the refresh error. Neither is called here.
//   * R2 etags, httpEtags, bundle_etag values: compared in the route, emitted
//     as booleans.
//   * email addresses, tokens, newsletter tok, key shapes, R2 keys of the
//     email-keyed prefixes. privacyWalk() is the last line of defence and
//     counts anything that gets that far.

import { bestSince, dueAt, holdDeadline, normalisePolicy } from "./_presend.js";

const MIN = 60_000;
const HOUR = 3600_000;
const DAY = 86400_000;

// ── TIMING. Measured, not copied. ───────────────────────────────────────────
// The daily refresh (cron "0 9 * * *" in two lines) has landed 13:06-16:00 UTC
// over the last 14 runs, so the refresh is due at 09:00 and only overdue at
// 17:00. pipeline-now.js's 4 h grace is red on most healthy days; its due
// anchor (the most recent 09:00 UTC at or before now) is kept.
export const REFRESH_DUE_HOUR_UTC = 9;
// due + 8 h = 17:00 UTC: an hour past the latest landing seen.
export const REFRESH_GREY_H = 8;
// Same limit as _presend.js max_status_age_h: older means not running at all.
export const REFRESH_MAX_AGE_H = 36;
// A run time or a send more than this far ahead of the edge's clock is a bad
// clock, not a run: counted as one, a 2099 ran_at would hold the refresh tile
// green, and a 2099 log entry would count as every future Monday's delivery.
// An hour covers any real skew between a runner and the edge.
export const FUTURE_SKEW_MS = HOUR;
// Monday sends have logged 15:20-18:46 UTC; the hold hour comes from the
// presend policy (20:00 UTC by default), never from here.
const SEND_WINDOW_TEXT = "recent sends 15:20-18:46 UTC";
const REFRESH_WINDOW_TEXT = "usually 13:00-16:00 UTC";

// ── SOURCES. ────────────────────────────────────────────────────────────────
// A source is "new trouble" for a week; after that it is a standing condition.
export const SOURCE_RECENT_DAYS = 7;
// The engine needs 3 consecutive low runs to call a source collapsed, and it
// scores one run a day, so consecutive_low <= 3 + 7 means collapsed this week.
export const COLLAPSE_ENTRY_RUNS = 3;
const BAD_STATES = new Set(["dead", "failing", "collapsed", "vanished", "stale"]);
const KNOWN_STATES = new Set(["ok", "dead", "failing", "collapsed", "vanished", "stale", "new"]);
const NAMED_TOWNS_MAX = 5; // towns named in one line, then "+k more"

// ── MONEY AND COUNTS. ───────────────────────────────────────────────────────
const RENEWAL_DAYS = 14;       // renewals tile window
const REVENUE_DAYS = 30;       // gross collected window (matches the Stripe reads)
const SALES_DAYS = 7;          // sales tile window
const SIGNUP_DAYS = 7;         // signups tile window
const PAYING_LOOKBACK_DAYS = 7; // paying drop compares against a week ago
const ENTITLED = new Set(["active", "trialing", "past_due"]);
const CUSTOMER_ROWS_MAX = 100; // keeps the payload small on a phone

// ── PORTAL. health.js's rule: same 8 days and 15 minutes as leads.js. ───────
const PORTAL_STALE_MS = 8 * DAY;
const PORTAL_DRIFT_MS = 15 * MIN;

// ── REGISTRY AND OUTREACH. ──────────────────────────────────────────────────
const REGISTRY_MAX_AGE_DAYS = 30; // probe-map.json is uploaded by hand
const OUTREACH_MAX_BYTES = 64 * 1024;
const OUTREACH_STATES = new Set(["planned", "sent", "answered", "declined"]);
const NOTE_MAX = 80;
const NAME_MAX = 80;
const IGNORED_MAX = 50;

// ── THE 351 TOWNS. Keys and aliases of admin/mission-towns.json (public
// Census geometry); test/mission checks they match that file exactly. ──────
const TOWN_LIST =
  "Abington|Acton|Acushnet|Adams|Agawam|Alford|Amesbury|Amherst|Andover|Aquinnah|" +
  "Arlington|Ashburnham|Ashby|Ashfield|Ashland|Athol|Attleboro|Auburn|Avon|Ayer|" +
  "Barnstable|Barre|Becket|Bedford|Belchertown|Bellingham|Belmont|Berkley|Berlin|" +
  "Bernardston|Beverly|Billerica|Blackstone|Blandford|Bolton|Boston|Bourne|Boxborough|" +
  "Boxford|Boylston|Braintree|Brewster|Bridgewater|Brimfield|Brockton|Brookfield|" +
  "Brookline|Buckland|Burlington|Cambridge|Canton|Carlisle|Carver|Charlemont|Charlton|" +
  "Chatham|Chelmsford|Chelsea|Cheshire|Chester|Chesterfield|Chicopee|Chilmark|" +
  "Clarksburg|Clinton|Cohasset|Colrain|Concord|Conway|Cummington|Dalton|Danvers|" +
  "Dartmouth|Dedham|Deerfield|Dennis|Dighton|Douglas|Dover|Dracut|Dudley|Dunstable|" +
  "Duxbury|East Bridgewater|East Brookfield|East Longmeadow|Eastham|Easthampton|Easton|" +
  "Edgartown|Egremont|Erving|Essex|Everett|Fairhaven|Fall River|Falmouth|Fitchburg|" +
  "Florida|Foxborough|Framingham|Franklin|Freetown|Gardner|Georgetown|Gill|Gloucester|" +
  "Goshen|Gosnold|Grafton|Granby|Granville|Great Barrington|Greenfield|Groton|Groveland|" +
  "Hadley|Halifax|Hamilton|Hampden|Hancock|Hanover|Hanson|Hardwick|Harvard|Harwich|" +
  "Hatfield|Haverhill|Hawley|Heath|Hingham|Hinsdale|Holbrook|Holden|Holland|Holliston|" +
  "Holyoke|Hopedale|Hopkinton|Hubbardston|Hudson|Hull|Huntington|Ipswich|Kingston|" +
  "Lakeville|Lancaster|Lanesborough|Lawrence|Lee|Leicester|Lenox|Leominster|Leverett|" +
  "Lexington|Leyden|Lincoln|Littleton|Longmeadow|Lowell|Ludlow|Lunenburg|Lynn|Lynnfield|" +
  "Malden|Manchester-by-the-Sea|Mansfield|Marblehead|Marion|Marlborough|Marshfield|" +
  "Mashpee|Mattapoisett|Maynard|Medfield|Medford|Medway|Melrose|Mendon|Merrimac|Methuen|" +
  "Middleborough|Middlefield|Middleton|Milford|Millbury|Millis|Millville|Milton|Monroe|" +
  "Monson|Montague|Monterey|Montgomery|Mount Washington|Nahant|Nantucket|Natick|Needham|" +
  "New Ashford|New Bedford|New Braintree|New Marlborough|New Salem|Newbury|Newburyport|" +
  "Newton|Norfolk|North Adams|North Andover|North Attleborough|North Brookfield|" +
  "North Reading|Northampton|Northborough|Northbridge|Northfield|Norton|Norwell|Norwood|" +
  "Oak Bluffs|Oakham|Orange|Orleans|Otis|Oxford|Palmer|Paxton|Peabody|Pelham|Pembroke|" +
  "Pepperell|Peru|Petersham|Phillipston|Pittsfield|Plainfield|Plainville|Plymouth|" +
  "Plympton|Princeton|Provincetown|Quincy|Randolph|Raynham|Reading|Rehoboth|Revere|" +
  "Richmond|Rochester|Rockland|Rockport|Rowe|Rowley|Royalston|Russell|Rutland|Salem|" +
  "Salisbury|Sandisfield|Sandwich|Saugus|Savoy|Scituate|Seekonk|Sharon|Sheffield|" +
  "Shelburne|Sherborn|Shirley|Shrewsbury|Shutesbury|Somerset|Somerville|South Hadley|" +
  "Southampton|Southborough|Southbridge|Southwick|Spencer|Springfield|Sterling|" +
  "Stockbridge|Stoneham|Stoughton|Stow|Sturbridge|Sudbury|Sunderland|Sutton|Swampscott|" +
  "Swansea|Taunton|Templeton|Tewksbury|Tisbury|Tolland|Topsfield|Townsend|Truro|" +
  "Tyngsborough|Tyringham|Upton|Uxbridge|Wakefield|Wales|Walpole|Waltham|Ware|Wareham|" +
  "Warren|Warwick|Washington|Watertown|Wayland|Webster|Wellesley|Wellfleet|Wendell|" +
  "Wenham|West Boylston|West Bridgewater|West Brookfield|West Newbury|West Springfield|" +
  "West Stockbridge|West Tisbury|Westborough|Westfield|Westford|Westhampton|Westminster|" +
  "Weston|Westport|Westwood|Weymouth|Whately|Whitman|Wilbraham|Williamsburg|" +
  "Williamstown|Wilmington|Winchendon|Winchester|Windsor|Winthrop|Woburn|Worcester|" +
  "Worthington|Wrentham|Yarmouth";
const TOWN_ALIASES = Object.freeze({
  "foxboro": "Foxborough",
  "north attleboro": "North Attleborough",
  "attleborough": "Attleboro",
  "manchester": "Manchester-by-the-Sea",
  "manchester by the sea": "Manchester-by-the-Sea",
  "mt washington": "Mount Washington",
  "mt. washington": "Mount Washington",
  "boxboro": "Boxborough",
  "middleboro": "Middleborough",
  "marlboro": "Marlborough",
  "southboro": "Southborough",
  "northboro": "Northborough",
  "westboro": "Westborough",
  "tyngsboro": "Tyngsborough",
  "winthrop town": "Winthrop",
});
export const TOWN_KEYS = Object.freeze(TOWN_LIST.split("|"));
const TOWN_SET = new Set(TOWN_KEYS);

export const MAP_CODES = Object.freeze(["dead", "weekly", "monthly", "answered", "sent", "locked", "none"]);
export const MAP_LEGEND = Object.freeze({
  dead: "Stale or dead source",
  weekly: "Live, weekly",
  monthly: "Live, monthly or slower",
  answered: "Outreach answered",
  sent: "Outreach sent",
  locked: "Locked behind OpenGov",
  none: "Not covered",
});

export const CLEAR_TEXT = "Nothing is wrong that this page can see.";
export const BLOCKED_SENTENCE = "Blocked by the town's site. That is an authorization decision: " +
  "do not retry, it will not come back by itself.";
const MONDAY_CAVEAT = "Resend accepted it; there is no bounce or open tracking.";

// ── small helpers ───────────────────────────────────────────────────────────
function isObj(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function iso(v) {
  if (v === null || v === undefined || v === "") return null;
  const t = v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(String(v));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function ms(v) {
  const i = iso(v);
  return i ? Date.parse(i) : NaN;
}

function dateOnly(v) {
  if (typeof v !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v);
  return m ? m[1] : null;
}

function day(t) {
  return new Date(t).toISOString().slice(0, 10);
}

function plural(n, word, many) {
  return n + " " + (n === 1 ? word : many || word + "s");
}

function money(cents) {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "$0.00";
  const neg = cents < 0;
  const whole = Math.floor(Math.abs(Math.round(cents)) / 100);
  const frac = String(Math.abs(Math.round(cents)) % 100).padStart(2, "0");
  return (neg ? "-" : "") + "$" + String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + frac;
}

function hhmm(t) {
  return new Date(t).toISOString().slice(11, 16);
}

// ── PRIVACY ─────────────────────────────────────────────────────────────────
const EMAIL_RE = /[^\s<>@"]+@[^\s<>@"]+\.[A-Za-z]{2,}/g;
const HEX32_RE = /\b[0-9a-f]{32}\b/g;
const KEY_RE = /\b(sk|rk)_(live|test)_[A-Za-z0-9]+/g;
const WHSEC_RE = /\bwhsec_[A-Za-z0-9]+/g;
const RESEND_RE = /\bre_[A-Za-z0-9]{8,}/g;
const PREFIX_RE = /prospects\/|newsletter\//g;
const WALK_RES = [EMAIL_RE, HEX32_RE, KEY_RE, WHSEC_RE, RESEND_RE, PREFIX_RE];
const WITHHELD = "[withheld]";

// "jane.doe@example.com" -> "j… · example.com". Never an "@".
export function maskEmail(v) {
  if (typeof v !== "string") return "hidden";
  const parts = v.trim().split("@");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return "hidden";
  const first = /^[A-Za-z0-9]/.test(parts[0]) ? parts[0][0].toLowerCase() : "*";
  const domain = parts[1].toLowerCase();
  if (!/^[a-z0-9.-]{1,80}$/.test(domain) || /[0-9a-f]{32}/.test(domain)) return "hidden";
  return first + "… · " + domain;
}

export function cleanName(v) {
  const s = String(v === null || v === undefined ? "" : v)
    .replace(/[\u0000-\u001F\u007F-\u009F\u061C​-‏‪-‮⁦-⁩]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const cut = Array.from(s).slice(0, NAME_MAX).join("").trim();
  return cut || "(no name)";
}

// Buyer-supplied text that happens to be email-, token- or key-shaped is
// neutralised at the projection, so a hostile name cannot turn the page red.
// privacyWalk() still counts anything that reaches it by any other path.
function neutral(s) {
  let out = String(s);
  for (const re of WALK_RES) out = out.replace(re, "…");
  return out.replace(/@/g, " ");
}

function safeName(v) {
  return neutral(cleanName(v));
}

function townName(k) {
  return neutral(cleanName(String(k).replace(/,\s*MA$/i, ""))).slice(0, 60);
}

export function t8(token) {
  return typeof token === "string" && /^[0-9a-f]{32}$/.test(token) ? token.slice(0, 8) : null;
}

export function stripeUrl(id) {
  if (typeof id !== "string") return null;
  const m = /^(cus|sub|in)_[A-Za-z0-9]{6,64}$/.exec(id);
  if (!m) return null;
  const kind = { cus: "customers", sub: "subscriptions", in: "invoices" }[m[1]];
  return "https://dashboard.stripe.com/" + kind + "/" + id;
}

// Runs last on every 200 of both views. Returns a new payload and the count.
export function privacyWalk(payload) {
  let count = 0;
  const scrub = (s) => {
    let out = s;
    for (const re of WALK_RES) {
      out = out.replace(re, () => { count++; return WITHHELD; });
    }
    return out;
  };
  const seen = new WeakSet();
  const walk = (v, top) => {
    if (typeof v === "string") return scrub(v);
    if (!v || typeof v !== "object") return v;
    if (seen.has(v)) return null;
    seen.add(v);
    if (Array.isArray(v)) return v.map((x) => walk(x, false));
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      // signed_in_as is the owner's own verified Access email, not customer
      // data. Exempt only as the payload's own top-level member: a member of
      // that name anywhere deeper is walked like every other value.
      if (top && k === "signed_in_as") { out[k] = x; continue; }
      out[scrub(k)] = walk(x, false);
    }
    return out;
  };
  const out = walk(payload, true);
  return { payload: out, redactions: count };
}

export function privacyLine(n) {
  return {
    id: "privacy", severity: "red",
    text: "The privacy check withheld " + plural(n, "value") + " from this page. " +
      "Something upstream tried to show customer data; the page needs a fix.",
    where: "This page's code (functions/api/_mission_data.js)",
  };
}

// ── ENGINE TEXT → fixed codes ───────────────────────────────────────────────
export function errKind(s) {
  if (typeof s !== "string" || !s) return "other";
  if (/owner name|rule 5/i.test(s)) return "owner_name_gate";
  if (/\b40[13]\b|authori[sz]ation decision|login wall|requires_credentials|robots/i.test(s)) {
    return "access_controlled";
  }
  if (/returned \d+ rows|no rows|silently dead/i.test(s)) return "no_rows";
  if (/timed? ?out/i.test(s)) return "timeout";
  if (/\bHTTP\b|\b[45]\d\d\b|URLError|connection|SSL/i.test(s)) return "http_error";
  if (/pars(e|ing|er)|column|header|decode|JSON/i.test(s)) return "parse";
  return "other";
}

// Only for a run with ok === false and degraded !== true; undefined otherwise.
export function failKind(status) {
  if (!isObj(status) || status.ok !== false || status.degraded === true) return undefined;
  const e = typeof status.error === "string" ? status.error : "";
  if (/crashed/.test(e)) return "crash";
  if (/^ABORT\b/.test(e)) return "gate";
  return "unknown";
}

const FAIL_WORDS = { crash: "crashed", gate: "was stopped by its quality gate", unknown: "failed" };

// ── REFRESH ─────────────────────────────────────────────────────────────────
// The most recent 09:00 UTC at or before now (pipeline-now.js lastDue). From
// 00:00 to 08:59 UTC that is YESTERDAY 09:00.
export function lastDue(now, hourUtc = REFRESH_DUE_HOUR_UTC) {
  const d = new Date(now);
  d.setUTCHours(hourUtc, 0, 0, 0);
  if (d.getTime() > now) d.setUTCDate(d.getUTCDate() - 1);
  return d.getTime();
}

// inp: { now, status, head: "present"|"absent"|"unreadable", weeklyUploaded }
export function refreshState(inp) {
  const { now } = inp;
  const status = isObj(inp.status) ? inp.status : null;
  const due = lastDue(now);
  const out = (state, rule, extra) => ({ state, rule, due, ...extra });
  if (inp.head === "unreadable" || (inp.head === "present" && !status)) {
    return out("grey", "unavailable", { grey: "unavailable" });
  }
  // 1. missing, or no usable ran_at
  const ranAt = status ? ms(status.ran_at) : NaN;
  if (!status || !Number.isFinite(ranAt) || ranAt > now + FUTURE_SKEW_MS) return out("red", "missing");
  // 2. too old
  if (now - ranAt > REFRESH_MAX_AGE_H * HOUR) return out("red", "too_old", { ranAt });
  // 3. the latest run failed (the state weekly-send.js refuses to send on)
  const fk = failKind(status);
  if (fk) return out("red", "failed", { ranAt, fail_kind: fk });
  // 4. landed
  if (ranAt >= due) {
    return status.degraded === true ? out("amber", "reduced", { ranAt }) : out("green", "landed", { ranAt });
  }
  // 5. bundles shipped, status file did not upload
  const zip = ms(inp.weeklyUploaded);
  if (Number.isFinite(zip) && zip >= due) return out("amber", "bundles_shipped", { ranAt });
  // 6. not yet
  if (now < due + REFRESH_GREY_H * HOUR) return out("grey", "pending", { ranAt, grey: "pending" });
  // 7. not landed by 17:00 UTC
  return out("red", "not_landed", { ranAt });
}

// ── MONDAY ──────────────────────────────────────────────────────────────────
function normEmail(v) {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

function activeRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter((s) => isObj(s) && s.email && s.active !== false);
}

// Log entries that are not from the future (FUTURE_SKEW_MS).
function pastEntries(log, now) {
  return (Array.isArray(log) ? log : []).filter((e) => !(isObj(e) && ms(e.at) > now + FUTURE_SKEW_MS));
}

function delivered(entry) {
  return !!entry && Array.isArray(entry.sent) && entry.sent.some((s) => s && s.ok);
}

// inp: { now, policy, log, attempt, roster: { state, rows } }
export function mondayReach(inp) {
  const { now } = inp;
  const p = normalisePolicy(inp.policy);
  const due = dueAt(now, p);
  const hold = holdDeadline(due, p);
  const mondayDate = day(due);
  const log = pastEntries(inp.log, now);
  const entries = log.filter((e) => isObj(e) && Number.isFinite(ms(e.at)) && ms(e.at) >= due);

  const okCount = new Map();
  for (const e of entries) {
    for (const s of Array.isArray(e.sent) ? e.sent : []) {
      if (s && s.ok) {
        const a = normEmail(s.to);
        if (a) okCount.set(a, (okCount.get(a) || 0) + 1);
      }
    }
  }
  const failed = new Set();
  for (const e of entries) {
    const at = ms(e.at);
    for (const s of Array.isArray(e.sent) ? e.sent : []) {
      if (!s || s.ok) continue;
      const a = normEmail(s.to);
      if (!a) continue;
      const laterOk = entries.some((x) => ms(x.at) >= at &&
        (Array.isArray(x.sent) ? x.sent : []).some((y) => y && y.ok && normEmail(y.to) === a));
      if (!laterOk) failed.add(a);
    }
  }
  const duplicates = [...okCount].filter(([, n]) => n > 1).map(([a]) => a);
  const anyDelivered = okCount.size > 0;
  const skippedOnly = entries.length > 0 && !anyDelivered && entries.every((e) => e.skipped);
  const attemptAt = inp.attempt ? ms(inp.attempt.at) : NaN;
  const noResult = Number.isFinite(attemptAt) && attemptAt >= due && entries.length === 0;

  const rosterOk = inp.roster && inp.roster.state === "ok";
  const rows = rosterOk ? activeRows(inp.roster.rows) : [];
  const expected = [], joined = [];
  let newSince = 0;
  for (const r of rows) {
    const since = dateOnly(r.since);
    if (since && since > mondayDate) newSince++;
    else if (since === mondayDate) { if (!okCount.has(normEmail(r.email))) joined.push(r); }
    else expected.push(r);
  }
  const missing = anyDelivered ? expected.filter((r) => !okCount.has(normEmail(r.email))) : [];

  let state, rule;
  if (failed.size) { state = "red"; rule = "failed"; }
  else if (missing.length) { state = "red"; rule = "missing"; }
  else if (skippedOnly) { state = "red"; rule = "skipped"; }
  else if (noResult) { state = "red"; rule = "no_result"; }
  else if (!anyDelivered && now >= hold) { state = "red"; rule = "nothing"; }
  else if (!anyDelivered) { state = "grey"; rule = "pending"; }
  else if (duplicates.length) { state = "amber"; rule = "duplicate"; }
  else if (!rosterOk) { state = "amber"; rule = "roster_unreadable"; }
  else { state = "green"; rule = "delivered"; }

  const best = bestSince(log, due);
  return {
    state, rule, grey: state === "grey" ? "pending" : undefined,
    due, hold, hold_hour: p.hold_until_hour, monday_date: mondayDate,
    delivered: okCount.size,
    expected: rosterOk ? expected.length : null,
    missing, failed: [...failed], duplicates, joined, new_since: newSince,
    skipped_only: skippedOnly, no_result: noResult,
    best_at: best ? iso(best.at) : null,
  };
}

// ── SOURCE TRIAGE ───────────────────────────────────────────────────────────
// projection: { key: {state, cadence, first_seen, last_good, consecutive_low, ek} }
export function sourceTriage(projection, refreshStatus, now) {
  const recs = isObj(projection) ? projection : {};
  const errors = isObj(refreshStatus) && isObj(refreshStatus.errors) ? refreshStatus.errors : null;
  const keys = new Set();
  for (const [k, r] of Object.entries(recs)) if (isObj(r) && r.state !== "ok") keys.add(k);
  if (errors) for (const k of Object.keys(errors)) keys.add(k);

  const groups = {
    sources_blocked: [], sources_vanished: [], sources_failing: [], sources_stale: [],
    sources_down: [], sources_down_long: [],
  };
  const sources = [];
  for (const key of [...keys].sort()) {
    const rec = isObj(recs[key]) ? recs[key] : null;
    const inErr = !!errors && Object.prototype.hasOwnProperty.call(errors, key);
    const state = inErr && (!rec || rec.state === "ok") ? "failing" : rec ? rec.state : "unknown";
    const ek = inErr ? errKind(errors[key]) : rec && rec.ek ? rec.ek : "other";
    const sinceIso = rec ? rec.last_good || rec.first_seen || null : null;
    const since = sinceIso ? sinceIso.slice(0, 10) : null;
    const town = townName(key);
    const item = { town, state, since, ek, recent: false };
    let id = null;
    if (ek === "access_controlled") id = "sources_blocked";
    else if (state === "vanished") id = "sources_vanished";
    else if (state === "failing") id = "sources_failing";
    else if (state === "stale") id = "sources_stale";
    else if (state === "dead") {
      const t = ms(sinceIso);
      item.recent = !Number.isFinite(t) || now - t <= SOURCE_RECENT_DAYS * DAY;
      id = item.recent ? "sources_down" : "sources_down_long";
    } else if (state === "collapsed") {
      const cl = rec ? rec.consecutive_low : null;
      item.runs = Number.isInteger(cl) ? cl : null;
      item.recent = !Number.isInteger(cl) || cl <= COLLAPSE_ENTRY_RUNS + SOURCE_RECENT_DAYS;
      id = item.recent ? "sources_down" : "sources_down_long";
    }
    if (id) groups[id].push(item);
    sources.push({ town, state, since, ek, recent: item.recent });
  }
  return { groups, sources };
}

function townList(items, fmt) {
  const shown = items.slice(0, NAMED_TOWNS_MAX).map(fmt);
  const more = items.length - shown.length;
  return shown.join(", ") + (more > 0 ? ", +" + more + " more" : "");
}

function downLabel(i) {
  if (i.state === "collapsed") {
    return i.town + (i.runs !== null && i.runs !== undefined ? " (collapsed, " + plural(i.runs, "run") + ")" : " (collapsed)");
  }
  return i.town + (i.since ? " (dead since " + i.since + ")" : " (dead)");
}

// ── PROJECTIONS of the two big objects (cached by etag in _mission_r2.js) ──
function cadenceOf(v) {
  if (v === null || v === undefined || v === "" || v === false) return null;
  return typeof v === "string" && /^[a-z][a-z_ -]{0,19}$/.test(v) ? v : "other";
}

function wordOf(v) {
  return typeof v === "string" && /^[a-z_]{1,32}$/.test(v) ? v : v ? "other" : null;
}

export function projectSourceHealth(obj) {
  const sources = {};
  const src = isObj(obj) && isObj(obj.sources) ? obj.sources : {};
  for (const [key, r] of Object.entries(src)) {
    if (!isObj(r) || key.length > 80) continue;
    const state = KNOWN_STATES.has(r.state) ? r.state : "unknown";
    sources[key] = {
      state,
      cadence: cadenceOf(r.cadence),
      first_seen: iso(r.first_seen),
      last_good: iso(r.last_good),
      consecutive_low: Number.isInteger(r.consecutive_low) ? r.consecutive_low : null,
      // The code only; last_error itself is never kept.
      ek: state === "ok" ? null : errKind(r.last_error),
    };
  }
  return { sources };
}

export function joinTown(prodKey) {
  if (typeof prodKey !== "string") return null;
  const s = prodKey.replace(/,\s*MA\s*$/i, "").trim();
  if (TOWN_SET.has(s)) return s;
  const a = TOWN_ALIASES[s.toLowerCase()];
  return a && TOWN_SET.has(a) ? a : null;
}

export function projectRegistry(obj) {
  const reg = isObj(obj) && isObj(obj.registry) ? obj.registry : {};
  const towns = {};
  for (const t of Array.isArray(reg.towns) ? reg.towns : []) {
    if (!isObj(t)) continue;
    const key = joinTown(t.name);
    if (!key) continue;
    towns[key] = { method: wordOf(t.method), feasibility: wordOf(t.feasibility) };
  }
  return { generated: iso(reg.generated), available: reg.available === true, towns };
}

// admin/outreach.json. text: the body; size: bytes.
export function parseOutreach(text, size) {
  const bad = { state: "unreadable", towns: {}, ignored: [] };
  if (typeof text !== "string") return bad;
  if ((typeof size === "number" && size > OUTREACH_MAX_BYTES) || text.length > OUTREACH_MAX_BYTES) return bad;
  let o;
  try { o = JSON.parse(text); } catch (_) { return bad; }
  if (!isObj(o) || !isObj(o.towns)) return bad;
  const towns = {}, ignored = [];
  for (const [name, v] of Object.entries(o.towns)) {
    const key = TOWN_SET.has(name) ? name : joinTown(name);
    if (!key) {
      if (ignored.length < IGNORED_MAX) ignored.push(townName(name).slice(0, 40));
      continue;
    }
    if (!isObj(v)) continue;
    const t = {};
    if (OUTREACH_STATES.has(v.outreach)) t.outreach = v.outreach;
    if (dateOnly(v.since)) t.since = dateOnly(v.since);
    if (typeof v.locked === "boolean") t.locked = v.locked;
    if (typeof v.note === "string") t.note = cleanNote(v.note);
    towns[key] = t;
  }
  return { state: "present", towns, ignored };
}

// Redact first, then cut: cutting first can split an address or a number
// so the pattern no longer matches and a fragment survives. The scan is
// bounded (NOTE_SCAN chars) so a long note cannot make the patterns slow.
const NOTE_SCAN = 4 * NOTE_MAX;
function cleanNote(v) {
  const s = v.slice(0, NOTE_SCAN)
    .replace(/\S*@\S*/g, "[redacted]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[redacted]");
  return Array.from(s).slice(0, NOTE_MAX).join("").replace(/@/g, " ");
}

// ── MAP ─────────────────────────────────────────────────────────────────────
// inp: { status (refresh-status object or null), sh (projectSourceHealth or
// null), registry (projectRegistry or null), outreach (parseOutreach) }
export function mapCategories(inp) {
  const status = isObj(inp.status) ? inp.status : {};
  const rowsBy = isObj(status.sources) ? status.sources : null;
  const errors = isObj(status.errors) ? status.errors : null;
  const cadBy = isObj(status.cadence) ? status.cadence : null;
  const newestBy = isObj(status.newest) ? status.newest : null;
  const recs = inp.sh && isObj(inp.sh.sources) ? inp.sh.sources : {};
  const reg = inp.registry && isObj(inp.registry.towns) ? inp.registry.towns : {};
  const outreach = inp.outreach && inp.outreach.state === "present" ? inp.outreach.towns : {};

  const prodKeys = new Set();
  for (const m of [rowsBy, errors, recs]) if (m) for (const k of Object.keys(m)) prodKeys.add(k);

  const prod = {}; // town -> merged facts
  const unmatched = new Set();
  for (const k of prodKeys) {
    const town = joinTown(k);
    if (!town) { unmatched.add(townName(k)); continue; }
    const rec = isObj(recs[k]) ? recs[k] : null;
    const rows = rowsBy ? num(rowsBy[k]) : null;
    const inErr = !!errors && Object.prototype.hasOwnProperty.call(errors, k);
    const dead = rec ? BAD_STATES.has(rec.state) || inErr : inErr || !(rows > 0);
    const live = !dead && (rec ? rec.state === "ok" : rows > 0);
    const f = {
      dead, live, rows,
      newest: newestBy ? dateOnly(newestBy[k]) : null,
      state: rec ? rec.state : null,
      cadence: (cadBy && cadenceOf(cadBy[k])) || (rec && rec.cadence) || null,
      ek: inErr ? errKind(errors[k]) : rec && rec.state !== "ok" ? rec.ek || "other" : null,
    };
    const prev = prod[town];
    // Two production keys on one town (an alias and its canonical name):
    // trouble wins, then live, and facts come from the key that decided.
    if (!prev || (f.dead && !prev.dead) || (!prev.dead && f.live && !prev.live)) prod[town] = f;
  }

  const counts = {};
  for (const c of MAP_CODES) counts[c] = 0;
  const towns = {};
  let opengovRegistry = 0, ownerLocked = 0;
  for (const t of TOWN_KEYS) {
    const p = prod[t] || null;
    const r = reg[t] || null;
    const o = outreach[t] || null;
    if (r && r.method === "opengov") opengovRegistry++;
    if (o && o.locked === true) ownerLocked++;
    let k;
    const facts = {};
    if ((p && p.dead) || (r && r.feasibility === "built_not_wired")) {
      k = "dead";
      if (!(p && p.dead)) facts.lk = "paused";
    } else if (p && p.live) {
      k = p.cadence ? "monthly" : "weekly";
    } else if (o && (o.outreach === "answered" || o.outreach === "declined")) {
      k = "answered";
    } else if (o && o.outreach === "sent") {
      k = "sent";
    } else if ((o && o.locked === true) || (!(o && o.locked === false) && r && r.method === "opengov")) {
      k = "locked";
      facts.lk = o && o.locked === true ? "owner" : "opengov";
    } else {
      k = "none";
    }
    if (p) {
      if (p.rows !== null) facts.rows = p.rows;
      if (p.newest) facts.newest = p.newest;
      if (p.state) facts.state = p.state;
      if (p.cadence) facts.cadence = p.cadence;
      if (p.ek) facts.ek = p.ek;
    }
    if (o) {
      if (o.outreach) facts.o = o.outreach;
      if (o.since) facts.os = o.since;
      if (o.outreach === "planned") facts.planned = 1;
    }
    counts[k]++;
    if (k !== "none" || Object.keys(facts).length) towns[t] = { k, ...facts };
  }
  return {
    counts, towns,
    unmatched: [...unmatched].sort(),
    outreach_ignored: inp.outreach && Array.isArray(inp.outreach.ignored) ? inp.outreach.ignored.slice() : [],
    opengov: { registry: opengovRegistry, owner_list: ownerLocked },
  };
}

export function buildMap(inp) {
  const m = mapCategories(inp);
  return {
    ok: true, v: 1, now: iso(inp.now),
    as_of: {
      refresh: inp.asOf.refresh || null,
      source_health: inp.asOf.source_health || null,
      registry: inp.asOf.registry || null,
      outreach: inp.asOf.outreach || null,
    },
    counts: m.counts, towns: m.towns, unmatched: m.unmatched,
    outreach_ignored: m.outreach_ignored, opengov: m.opengov,
    privacy_redactions: 0,
  };
}

// ── TILES ───────────────────────────────────────────────────────────────────
const LABELS = {
  paying: "Paying customers",
  revenue: "Revenue, 30 days",
  renewals: "Renewals, 14 days",
  failed: "Failed payments",
  monday: "Monday email",
  refresh: "Data refresh",
  sales: "Sales, 7 days",
  signups: "Signups, 7 days",
};

function tile(id, state, value, sub, source, asOf, grey) {
  const t = { id, label: LABELS[id], state };
  if (state === "grey") t.grey = grey;
  t.value = state === "grey" && grey !== "unverified" ? null : value;
  t.sub = sub;
  t.source = source;
  t.as_of = asOf || null;
  return t;
}

function greyTile(id, grey, sub, source) {
  return tile(id, "grey", null, sub, source, null, grey);
}

function tsOf(meta) {
  const v = meta && meta.ts;
  if (typeof v === "number") return v > 1e12 ? v : v * 1000;
  if (typeof v !== "string" || !v) return NaN;
  if (/^\d+$/.test(v)) { const n = Number(v); return n > 1e12 ? n : n * 1000; }
  return Date.parse(v);
}

function monthlyCents(s) {
  if (typeof s.amount !== "number") return 0;
  const n = s.interval_count || 1;
  const per = { month: 1, year: 1 / 12, week: 52 / 12, day: 365 / 12 }[s.interval];
  return per ? (s.amount * per) / n : 0;
}

// Everything the tiles and needs-you lines derive from the reads.
export function context(inp) {
  const now = inp.now;
  const g = inp.gathered || {};
  const status = isObj(g.status) ? g.status : null;
  const stripe = inp.stripe || { state: "not-connected" };
  const stripeOn = ["ok", "partial", "unavailable"].includes(stripe.state);
  const usable = (name) => stripeOn && stripe[name] && stripe[name].state !== "unavailable";
  const partial = (name) => stripeOn && stripe[name] && stripe[name].state === "partial";
  const roster = inp.roster || { state: "unreadable" };
  const rosterOk = roster.state === "ok" && Array.isArray(roster.value);
  const rosterRows = rosterOk ? roster.value.filter(isObj) : [];
  const active = activeRows(rosterRows);
  const subs = usable("subscriptions") ? stripe.subscriptions.items : [];
  const entitled = subs.filter((s) => ENTITLED.has(s.status));
  const funnel = inp.funnel && inp.funnel.state === "ok" && Array.isArray(inp.funnel.value)
    ? inp.funnel.value.filter(isObj) : null;

  const refresh = refreshState({
    now, status, head: inp.statusHead ? inp.statusHead.state : "unreadable",
    weeklyUploaded: g.weekly ? g.weekly.uploaded : null,
  });
  const monday = mondayReach({
    now, policy: g.policy, log: g.log, attempt: g.attempt,
    roster: { state: rosterOk ? "ok" : "unreadable", rows: rosterRows },
  });
  const sh = inp.sourceHealth || { state: "unreadable" };
  const triage = sourceTriage(sh.proj ? sh.proj.sources : null, status, now);

  // paying drop: roster now vs the funnel snapshot nearest a week ago (like with like)
  let payingDrop = null;
  if (rosterOk && funnel && funnel.length) {
    const target = now - PAYING_LOOKBACK_DAYS * DAY;
    let best = null;
    for (const e of funnel) {
      const t = ms(e.at);
      if (!Number.isFinite(t) || num(e.paying) === null) continue;
      if (!best || Math.abs(t - target) < Math.abs(best.t - target)) best = { t, paying: e.paying };
    }
    if (best && active.length < best.paying) payingDrop = { was: best.paying, now: active.length, at: best.t };
  }

  return {
    now, status, stripe, stripeOn, usable, partial, rosterOk, rosterRows, active, subs, entitled,
    funnel, refresh, monday, triage, sh, payingDrop, g,
  };
}

export function tiles(ctx, inp) {
  const { now, stripe, stripeOn, usable, partial, rosterOk, active, entitled, subs } = ctx;
  const nowIso = iso(now);
  const out = [];

  // paying
  if (usable("subscriptions")) {
    const trials = entitled.filter((s) => s.status === "trialing").length;
    out.push(tile("paying", ctx.payingDrop ? "amber" : "green", entitled.length,
      (partial("subscriptions") ? "at least " + entitled.length + "; " : "") + plural(trials, "trial") +
      " included", "stripe", nowIso));
  } else if (rosterOk) {
    out.push(tile("paying", ctx.payingDrop ? "amber" : "green", active.length,
      "roster: feed and radar mixed, trials included", "r2", inp.roster.uploaded));
  } else {
    out.push(greyTile("paying", "unavailable", "the subscriber list could not be read", "r2"));
  }

  // revenue
  if (!stripeOn) {
    out.push(greyTile("revenue", "not-connected", "Stripe is not connected", "none"));
  } else if (!usable("invoices_paid") || !usable("sessions")) {
    out.push(greyTile("revenue", "unavailable", "Stripe could not be read", "stripe"));
  } else {
    const since = now - REVENUE_DAYS * DAY;
    const inv = stripe.invoices_paid.items.filter((i) => (i.created || 0) * 1000 >= since);
    const packs = stripe.sessions.items.filter((c) => c.mode === "payment" && !c.invoice &&
      (c.created || 0) * 1000 >= since);
    const gross = inv.reduce((a, i) => a + (i.amount_paid || 0), 0) +
      packs.reduce((a, c) => a + (c.amount_total || 0), 0);
    const rate = entitled.filter((s) => s.status !== "trialing").reduce((a, s) => a + monthlyCents(s), 0);
    const cut = partial("invoices_paid") || partial("sessions") || partial("subscriptions");
    out.push(tile("revenue", "green", gross,
      (cut ? "at least; " : "") + "list-price run rate " + money(rate) + "/mo", "stripe", nowIso));
  }

  // renewals
  if (!stripeOn) {
    out.push(greyTile("renewals", "not-connected", "Stripe is not connected", "none"));
  } else if (!usable("subscriptions")) {
    out.push(greyTile("renewals", "unavailable", "Stripe could not be read", "stripe"));
  } else {
    const r = renewalsDue(ctx);
    const ending = r.filter((s) => s.cancel_at_period_end).length;
    out.push(tile("renewals", ending ? "amber" : "green", r.length,
      (partial("subscriptions") ? "at least; " : "") +
      (ending ? plural(ending, "set", "set") + " to cancel" : "none set to cancel"), "stripe", nowIso));
  }

  // failed
  if (stripe.state === "ok") {
    const pd = subs.filter((s) => s.status === "past_due" || s.status === "unpaid").length;
    const open = stripe.invoices_open.items.filter((i) => (i.attempt_count || 0) > 0).length;
    out.push(tile("failed", pd + open > 0 ? "red" : "green", pd + open,
      plural(pd, "subscription") + " past due, " + plural(open, "open invoice") + " retried",
      "stripe", nowIso));
  } else if (rosterOk) {
    const n = ctx.rosterRows.filter((s) => s.payment_failing).length;
    if (n > 0) {
      out.push(tile("failed", "red", n, "flagged by the Stripe webhook", "r2", inp.roster.uploaded));
    } else {
      out.push(tile("failed", "grey", 0, "webhook flags only; registration not verified", "r2",
        inp.roster.uploaded, "unverified"));
    }
  } else {
    out.push(greyTile("failed", "unavailable", "the subscriber list could not be read", "r2"));
  }

  // monday
  const m = ctx.monday;
  const mSub = {
    delivered: "delivered to " + m.delivered + (m.expected !== null ? " of " + m.expected : "") +
      " on " + m.monday_date,
    pending: "not sent yet; " + SEND_WINDOW_TEXT,
    duplicate: plural(m.duplicates.length, "address", "addresses") + " got it more than once",
    roster_unreadable: "delivered to " + m.delivered + "; the subscriber list could not be read",
    failed: plural(m.failed.length, "delivery", "deliveries") + " failed",
    missing: plural(m.missing.length, "expected subscriber") + " not reached",
    skipped: "the send ran and mailed nobody",
    no_result: "a send started and never recorded a result",
    nothing: "nothing delivered by " + String(m.hold_hour).padStart(2, "0") + ":00 UTC",
  }[m.rule];
  // gather() turns a read that throws, or a body that does not parse, into
  // null, which reads as "nothing sent". The route records which of the two
  // send files failed that way; then the tile cannot say pending or red.
  const g0 = ctx.g || {};
  if (g0.log_state === "unreadable" || (g0.attempt_state === "unreadable" && !m.delivered)) {
    out.push(greyTile("monday", "unavailable", "the send log could not be read", "r2"));
  } else {
    out.push(m.state === "grey"
      ? greyTile("monday", "pending", mSub, "r2")
      : tile("monday", m.state, m.delivered, mSub, "r2", m.best_at));
  }

  // refresh
  const rf = ctx.refresh;
  const status = ctx.status;
  const count = status && num(status.count) !== null ? status.count : null;
  const rSub = {
    unavailable: "refresh-status.json could not be read",
    missing: "no refresh has reported",
    too_old: "has not run for more than " + REFRESH_MAX_AGE_H + " h",
    failed: "the latest run " + FAIL_WORDS[rf.fail_kind || "unknown"],
    landed: rf.ranAt ? "ran " + hhmm(rf.ranAt) + " UTC" : "",
    reduced: "reduced run; subscribers are told",
    bundles_shipped: "bundles shipped, status file did not upload",
    pending: "not landed yet, " + REFRESH_WINDOW_TEXT,
    not_landed: "today's run has not landed by 17:00 UTC",
  }[rf.rule];
  out.push(rf.state === "grey"
    ? greyTile("refresh", rf.grey, rSub, "r2")
    : tile("refresh", rf.state, count, rSub, "r2", rf.ranAt ? iso(rf.ranAt) : null));

  // sales
  const dl = inp.deliveries;
  if (dl && dl.state === "ok" && Array.isArray(dl.value)) {
    const since = now - SALES_DAYS * DAY;
    const newSales = dl.value.filter((e) => isObj(e) && e.kind === "monthly" && ms(e.at) >= since);
    let sub = "new checkouts from the delivery log";
    if (usable("invoices_paid") && usable("sessions")) {
      const s = salesMoney(ctx);
      sub = money(s.newSub + s.pack) + " gross: " + money(s.newSub) + " new subscriptions, " +
        money(s.pack) + " packs";
    }
    out.push(tile("sales", "green", newSales.length, sub, "r2", dl.uploaded));
  } else {
    out.push(greyTile("sales", "unavailable", "the delivery log could not be read", "r2"));
  }

  // signups
  const s = signupCounts(inp.lists, now);
  if (s) {
    out.push(tile("signups", "green", s.total,
      (s.at_least ? "at least; " : "") + "prospects " + s.prospects + " · agents " + s.agents +
      " · newsletter " + s.newsletter, "r2", nowIso));
  } else {
    out.push(greyTile("signups", "unavailable", "the signup lists could not be read", "r2"));
  }
  return out;
}

function renewalsDue(ctx) {
  const end = ctx.now + RENEWAL_DAYS * DAY;
  return ctx.entitled.filter((s) => typeof s.current_period_end === "number" &&
    s.current_period_end * 1000 >= ctx.now && s.current_period_end * 1000 <= end);
}

function salesMoney(ctx) {
  const since = ctx.now - SALES_DAYS * DAY;
  const newSub = ctx.stripe.invoices_paid.items
    .filter((i) => i.billing_reason === "subscription_create" && (i.created || 0) * 1000 >= since)
    .reduce((a, i) => a + (i.amount_paid || 0), 0);
  const pack = ctx.stripe.sessions.items
    .filter((c) => c.mode === "payment" && !c.invoice && (c.created || 0) * 1000 >= since)
    .reduce((a, c) => a + (c.amount_total || 0), 0);
  return { newSub, pack };
}

function signupCounts(lists, now) {
  const L = lists || {};
  const names = ["prospects", "agents", "newsletter"];
  if (!names.every((n) => L[n] && L[n].state === "ok" && Array.isArray(L[n].items))) return null;
  const since = now - SIGNUP_DAYS * DAY;
  const byDay = {};
  for (let i = SIGNUP_DAYS - 1; i >= 0; i--) byDay[day(now - i * DAY)] = 0;
  const recent = (m) => { const t = tsOf(m); return Number.isFinite(t) && t >= since && t <= now + DAY; };
  const bump = (m) => { const d = day(tsOf(m)); if (d in byDay) byDay[d]++; };
  const trades = {};
  let prospects = 0, agents = 0, newsletter = 0, confirmed = 0, pending = 0;
  for (const m of L.prospects.items) {
    if (!recent(m)) continue;
    prospects++; bump(m);
    const tr = m && typeof m.trade === "string" && m.trade ? neutral(cleanName(m.trade).toLowerCase()).slice(0, 30) : "unknown";
    trades[tr] = (trades[tr] || 0) + 1;
  }
  for (const m of L.agents.items) if (recent(m)) { agents++; bump(m); }
  for (const m of L.newsletter.items) {
    if (!m || m.un === "1") continue;
    if (m.c === "1") confirmed++; else pending++;
    if (recent(m)) { newsletter++; bump(m); }
  }
  return {
    total: prospects + agents + newsletter, prospects, agents, newsletter,
    at_least: names.some((n) => L[n].truncated),
    by_day: byDay, trades, newsletter_confirmed: confirmed, newsletter_pending: pending,
  };
}

// ── NEEDS YOU ───────────────────────────────────────────────────────────────
const TABLE = [
  ["privacy", "red"], ["refresh", "red"], ["monday", "red"], ["failed_payments", "red"],
  ["refresh", "amber"], ["monday", "amber"], ["paid_not_served", "amber"], ["sources_down", "amber"],
  ["unreadable", "amber"], ["paying_drop", "amber"], ["renewals_ending", "amber"],
  ["served_not_paid", "amber"], ["unknown_price", "amber"], ["webhook_events", "amber"],
  ["no_customer_id", "amber"], ["portal", "amber"], ["stripe_refused", "amber"],
  ["outreach_unreadable", "amber"],
  ["coverage_disclosed", "known"], ["sources_blocked", "known"], ["sources_vanished", "known"],
  ["sources_down_long", "known"], ["sources_failing", "known"], ["sources_stale", "known"],
  ["registry_age", "known"], ["stripe_not_connected", "known"], ["stripe_partial", "known"],
  ["outreach_absent", "known"], ["engagement", "known"],
];

function line(id, severity, text, where) {
  return { id, severity, text, where };
}

function mondayClause(ctx) {
  const now = ctx.now;
  const p = normalisePolicy(ctx.g.policy);
  const d = new Date(now);
  if (d.getUTCDay() !== 1) return "";
  d.setUTCHours(p.send_hour, 0, 0, 0);
  const best = bestSince(pastEntries(ctx.g.log, now), d.getTime());
  return delivered(best) ? "" : " Monday's email will not send while this is the latest run.";
}

export function needsYou(ctx, tileList, inp) {
  const lines = [];
  const T = Object.fromEntries(tileList.map((t) => [t.id, t]));
  const rf = ctx.refresh, m = ctx.monday, g = ctx.triage.groups, stripe = ctx.stripe;

  // refresh
  if (T.refresh.state === "red") {
    const text = {
      missing: "The data refresh has never reported: refresh-status.json is missing or has no run time.",
      too_old: "The data refresh has not run for more than " + REFRESH_MAX_AGE_H + " hours.",
      failed: "The data refresh " + FAIL_WORDS[rf.fail_kind || "unknown"] + "." + mondayClause(ctx),
      not_landed: "Today's data refresh has not landed by 17:00 UTC.",
    }[rf.rule];
    lines.push(line("refresh", "red", text, "/admin/pipeline"));
  } else if (T.refresh.state === "amber") {
    lines.push(line("refresh", "amber", rf.rule === "reduced"
      ? "The data refresh ran reduced; subscribers are told coverage is short."
      : "The bundles shipped but the refresh status file did not upload.", "/admin/pipeline"));
  }

  // monday
  if (T.monday.state === "red") {
    const hh = String(m.hold_hour).padStart(2, "0");
    const text = {
      failed: "Monday's email failed for " + plural(m.failed.length, "subscriber") + ". Read the send log before anything else.",
      missing: "Monday's email did not reach " + plural(m.missing.length, "expected subscriber") + ".",
      skipped: "Monday's send ran and mailed nobody (skipped as already delivered).",
      no_result: "A Monday send started and never recorded a result. Read the send log before anything else.",
      nothing: "No Monday email was delivered by " + hh + ":00 UTC.",
    }[m.rule];
    lines.push(line("monday", "red", text, "Monday delivery, below"));
  } else if (T.monday.state === "amber") {
    lines.push(line("monday", "amber", m.rule === "duplicate"
      ? plural(m.duplicates.length, "subscriber") + " got Monday's email more than once."
      : "Monday's email went out, but the subscriber list could not be read to confirm everyone got it.",
    "Monday delivery, below"));
  }

  if (T.failed.state === "red") {
    lines.push(line("failed_payments", "red",
      plural(T.failed.value, "failed payment") + " need attention.", "Stripe dashboard"));
  }

  // paid, maybe not served
  if (ctx.usable("subscriptions") && ctx.rosterOk) {
    const onRoster = new Set(ctx.rosterRows.map((r) => r.customer).filter(Boolean));
    const n = ctx.entitled.filter((s) => s.customer && !onRoster.has(s.customer)).length;
    if (n) {
      lines.push(line("paid_not_served", "amber",
        plural(n, "subscription") + " paid, maybe not served: check Stripe.", "Stripe dashboard"));
    }
  }

  if (g.sources_down.length) {
    const n = g.sources_down.length;
    lines.push(line("sources_down", "amber",
      plural(n, "source") + " down in the last " + SOURCE_RECENT_DAYS + " days: " +
      townList(g.sources_down, downLabel) + ". See the map.", "The map"));
  }

  const unreadable = tileList.filter((t) => t.state === "grey" && t.grey === "unavailable").map((t) => t.label);
  if (ctx.sh.state === "unreadable") unreadable.push("Source health");
  if (unreadable.length) {
    lines.push(line("unreadable", "amber",
      "Could not read: " + unreadable.join(", ") + ". Reload; if it stays, check /admin/pipeline.",
      "/admin/pipeline"));
  }

  if (T.paying.state === "amber" && ctx.payingDrop) {
    lines.push(line("paying_drop", "amber",
      "Paying customers on the roster fell from " + ctx.payingDrop.was + " to " + ctx.payingDrop.now +
      " since " + day(ctx.payingDrop.at) + ".", "Customers, below"));
  }
  if (T.renewals.state === "amber") {
    const n = renewalsDue(ctx).filter((s) => s.cancel_at_period_end).length;
    lines.push(line("renewals_ending", "amber",
      plural(n, "subscription") + " will end at renewal in the next " + RENEWAL_DAYS + " days.",
      "Renewals, below"));
  }
  if (stripe.state === "ok" && ctx.rosterOk) {
    const paid = new Set(ctx.entitled.map((s) => s.customer).filter(Boolean));
    const n = ctx.active.filter((r) => r.customer && !paid.has(r.customer)).length;
    if (n) {
      lines.push(line("served_not_paid", "amber",
        plural(n, "roster row") + " served with no paying MassPermits subscription.", "Stripe dashboard"));
    }
  }
  if (ctx.usable("subscriptions")) {
    const n = new Set(ctx.subs.filter((s) => s.unknown_prices > 0).map((s) => s.customer || s.id)).size;
    if (n) {
      lines.push(line("unknown_price", "amber",
        plural(n, "customer") + " also hold a price that is not in MASSPERMITS_PRICE_IDS.",
        "MASSPERMITS_PRICE_IDS (Pages settings)"));
    }
  }
  if (ctx.stripeOn && stripe.webhooks && stripe.webhooks.events) {
    const missing = Object.entries(stripe.webhooks.events).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) {
      lines.push(line("webhook_events", "amber",
        "Not registered on any Stripe webhook endpoint: " + missing.join(", ") + ".",
        "Stripe dashboard, Webhooks"));
    }
  }
  const fm0 = ctx.funnel && ctx.funnel.length ? ctx.funnel[0] : null;
  if (fm0 && num(fm0.no_customer_id) > 0) {
    lines.push(line("no_customer_id", "amber",
      plural(fm0.no_customer_id, "roster row") + " without a Stripe customer id: a cancellation cannot match it.",
      "Customers, below"));
  }
  const portal = portalState(ctx.now, inp.htmlHead, ctx.g.weekly);
  if (portal === "stale" || portal === "drift") {
    lines.push(line("portal", "amber", portal === "stale"
      ? "The customer portal page is more than 8 days old."
      : "The portal page and the download were published more than 15 minutes apart.", "/admin/pipeline"));
  }
  if (stripe.state === "refused") {
    lines.push(line("stripe_refused", "amber",
      "STRIPE_READ_KEY is set but is not a restricted live read key, so no Stripe call was made.",
      "STRIPE_READ_KEY (Pages settings)"));
  }
  const outState = inp.outreachHead ? inp.outreachHead.state : "unreadable";
  if (outState === "unreadable") {
    lines.push(line("outreach_unreadable", "amber",
      "admin/outreach.json is present but could not be read; the map shows no outreach.", "admin/outreach.json in R2"));
  }

  // known
  const cov = ctx.status && isObj(ctx.status.coverage) ? ctx.status.coverage : null;
  if (cov && cov.disclose === true) {
    lines.push(line("coverage_disclosed", "known",
      "Subscribers are told coverage is reduced (" + (num(cov.live_sources) ?? "?") + " of " +
      (num(cov.expected_sources) ?? "?") + " sources live). This stays until coverage returns.",
      "Data refresh, below"));
  }
  const known = (id, items, text) => { if (items.length) lines.push(line(id, "known", text, "The map")); };
  known("sources_blocked", g.sources_blocked, plural(g.sources_blocked.length, "source") + ": " +
    townList(g.sources_blocked, (i) => i.town) + ". " + BLOCKED_SENTENCE);
  known("sources_vanished", g.sources_vanished, plural(g.sources_vanished.length, "source") +
    " dropped from the engine's registry: " + townList(g.sources_vanished, (i) => i.town) + ".");
  known("sources_down_long", g.sources_down_long, plural(g.sources_down_long.length, "source") +
    " down for more than " + SOURCE_RECENT_DAYS + " days: " +
    townList(g.sources_down_long, (i) => i.town + (i.since ? " (down since " + i.since + ")" : "")) + ".");
  known("sources_failing", g.sources_failing, plural(g.sources_failing.length, "source") +
    " failed the latest run: " + townList(g.sources_failing, (i) => i.town) +
    ". The engine calls a source dead only after 3 failed runs and 48 h, and emails you then.");
  known("sources_stale", g.sources_stale, plural(g.sources_stale.length, "source") +
    " stale (the window froze; the engine emails once per episode): " +
    townList(g.sources_stale, (i) => i.town) + ".");
  const regUp = inp.probeHead && inp.probeHead.state === "present" ? ms(inp.probeHead.uploaded) : NaN;
  if (Number.isFinite(regUp) && ctx.now - regUp > REGISTRY_MAX_AGE_DAYS * DAY) {
    lines.push(line("registry_age", "known",
      "The town registry (probe-map.json) was last uploaded " + day(regUp) + ", more than " +
      REGISTRY_MAX_AGE_DAYS + " days ago.", "probe-map.json (uploaded by hand)"));
  }
  if (stripe.state === "not-connected") {
    lines.push(line("stripe_not_connected", "known",
      "Stripe is not connected (" + (stripe.reason === "price list missing"
        ? "MASSPERMITS_PRICE_IDS is missing" : "STRIPE_READ_KEY is missing") +
      "): revenue and renewals are not shown.", "Pages settings"));
  }
  if (stripe.state === "partial") {
    lines.push(line("stripe_partial", "known",
      "A Stripe list still had more after 3 pages; its totals are \"at least\".", "Stripe dashboard"));
  }
  if (outState === "absent") {
    lines.push(line("outreach_absent", "known",
      "admin/outreach.json is not in R2 yet, so the map shows no outreach.", "Owner setup step 4"));
  }
  const ec = engagementCounts(inp.engagement);
  if (ec && ((ec["never-downloaded"] || 0) > 0 || (ec.lapsed || 0) > 0)) {
    lines.push(line("engagement", "known",
      plural(ec["never-downloaded"] || 0, "customer") + " never downloaded, " +
      (ec.lapsed || 0) + " lapsed (standing counts).", "engagement.json"));
  }

  // Fixed table order.
  const rank = (l) => TABLE.findIndex(([id, sev]) => id === l.id && sev === l.severity);
  return lines.sort((a, b) => rank(a) - rank(b));
}

export function headlineOf(lines) {
  const red = lines.find((l) => l.severity === "red");
  if (red) return { state: "red", text: red.text };
  const amber = lines.find((l) => l.severity === "amber");
  if (amber) return { state: "amber", text: amber.text };
  return { state: "clear", text: CLEAR_TEXT };
}

function portalState(now, htmlHead, weekly) {
  const tHtml = htmlHead && htmlHead.state === "present" ? ms(htmlHead.uploaded) : NaN;
  const tZip = weekly ? ms(weekly.uploaded) : NaN;
  if (!Number.isFinite(tHtml)) return "not_published";
  if (now - tHtml > PORTAL_STALE_MS) return "stale";
  if (Number.isFinite(tZip) && Math.abs(tHtml - tZip) > PORTAL_DRIFT_MS) return "drift";
  return "ok";
}

function engagementCounts(e) {
  if (!e || e.state !== "ok" || !isObj(e.value) || !isObj(e.value.counts)) return null;
  const out = {};
  for (const k of ["cancelled", "payment-failing", "unattributable", "warming", "never-downloaded", "lapsed", "healthy"]) {
    if (num(e.value.counts[k]) !== null) out[k] = e.value.counts[k];
  }
  return out;
}

// ── DETAIL ──────────────────────────────────────────────────────────────────
function customerRow(r, sub) {
  const status = sub ? sub.status + (sub.cancel_at_period_end ? ", cancels at period end" : "")
    : r.cancelled ? "cancelled" : r.payment_failing ? "payment failing" : r.active === false ? "inactive" : "active";
  return {
    name: safeName(r.name),
    email_masked: maskEmail(r.email),
    t8: t8(r.token),
    plan: sub ? planOf(sub) : null,
    status: neutral(String(status)).slice(0, 60),
    since: dateOnly(r.since),
    date: sub && sub.current_period_end ? day(sub.current_period_end * 1000) : null,
    amount_cents: sub ? sub.amount : null,
    currency: sub && typeof sub.currency === "string" ? sub.currency.slice(0, 3) : null,
    stripe_url: stripeUrl(r.customer),
  };
}

function planOf(sub) {
  const w = { month: "monthly", year: "annual", week: "weekly", day: "daily" }[sub.interval];
  return w || (sub.interval ? "other" : null);
}

function subRow(s, byCustomer, extra) {
  const r = (s.customer && byCustomer.get(s.customer)) || null;
  return {
    name: r ? safeName(r.name) : "(not on the roster)",
    email_masked: r ? maskEmail(r.email) : "hidden",
    t8: r ? t8(r.token) : null,
    plan: planOf(s),
    status: (extra && extra.status) || s.status,
    since: r ? dateOnly(r.since) : null,
    date: s.current_period_end ? day(s.current_period_end * 1000) : null,
    amount_cents: s.amount,
    currency: typeof s.currency === "string" ? s.currency.slice(0, 3) : null,
    stripe_url: stripeUrl(s.id) || stripeUrl(s.customer),
  };
}

const NOT_MEASURED = [
  { what: "Whether the email was actually delivered",
    why: "Resend accepting a message is all that is recorded. There is no bounce webhook and no open tracking." },
  { what: "Whether any subscriber opened the product",
    why: "No open tracking and no download tracking beyond the standing engagement counts." },
  { what: "Whether a cancelled customer is still being billed",
    why: "Only Stripe can say. With STRIPE_READ_KEY set, the webhook events line shows whether cancellations reach this site." },
  { what: "Whether a customer is waiting on a reply",
    why: "That lives in the inbox, which this page does not read." },
];

export function buildMain(inp) {
  const now = inp.now;
  const ctx = context(inp);
  const tileList = tiles(ctx, inp);
  const lines = needsYou(ctx, tileList, inp);
  const byCustomer = new Map();
  const byEmail = new Map();
  for (const r of ctx.rosterRows) {
    if (typeof r.customer === "string" && r.customer) byCustomer.set(r.customer, r);
    const e = normEmail(r.email);
    if (e) byEmail.set(e, r);
  }
  const subByCustomer = new Map();
  for (const s of ctx.entitled) if (s.customer && !subByCustomer.has(s.customer)) subByCustomer.set(s.customer, s);

  // customers
  const customers = ctx.rosterOk ? {
    source: "r2",
    count: ctx.active.length,
    cancelled: ctx.rosterRows.filter((r) => r.cancelled || r.active === false).length,
    rows: ctx.active.slice(0, CUSTOMER_ROWS_MAX).map((r) => customerRow(r, subByCustomer.get(r.customer))),
    more: Math.max(0, ctx.active.length - CUSTOMER_ROWS_MAX),
  } : { source: "r2", count: null, cancelled: null, rows: [], more: 0 };

  // renewals
  const renewals = ctx.usable("subscriptions")
    ? { rows: renewalsDue(ctx).map((s) => subRow(s, byCustomer,
      { status: s.cancel_at_period_end ? "cancels at period end" : s.status })) }
    : null;

  // failed payments
  const failedRows = [];
  if (ctx.usable("subscriptions")) {
    for (const s of ctx.subs) if (s.status === "past_due" || s.status === "unpaid") failedRows.push(subRow(s, byCustomer));
  }
  if (ctx.usable("invoices_open")) {
    for (const i of ctx.stripe.invoices_open.items) {
      if ((i.attempt_count || 0) <= 0) continue;
      const r = (i.customer && byCustomer.get(i.customer)) || null;
      failedRows.push({
        name: r ? safeName(r.name) : "(not on the roster)", email_masked: r ? maskEmail(r.email) : "hidden",
        t8: r ? t8(r.token) : null, plan: null,
        status: "open invoice, " + plural(i.attempt_count, "attempt"),
        since: r ? dateOnly(r.since) : null, date: i.created ? day(i.created * 1000) : null,
        amount_cents: i.amount_due, currency: typeof i.currency === "string" ? i.currency.slice(0, 3) : null,
        stripe_url: stripeUrl(i.id),
      });
    }
  }
  for (const r of ctx.rosterRows) {
    if (r.payment_failing) {
      const row = customerRow(r, null);
      row.status = "payment failing (webhook flag)";
      failedRows.push(row);
    }
  }

  // monday
  const m = ctx.monday;
  const personRow = (addr) => {
    const r = byEmail.get(addr);
    return r ? customerRow(r, null) : { name: "(not on the roster)", email_masked: maskEmail(addr),
      t8: null, plan: null, status: null, since: null, date: null, amount_cents: null, currency: null,
      stripe_url: null };
  };
  const mondayTile = tileList.find((t) => t.id === "monday");
  const mondayUnread = !!mondayTile && mondayTile.state === "grey" && mondayTile.grey === "unavailable";
  const monday = {
    state: mondayUnread ? "grey" : m.state, rule: mondayUnread ? "unreadable" : m.rule,
    due: iso(m.due), hold: iso(m.hold), monday_date: m.monday_date,
    best_at: m.best_at, delivered: m.delivered, expected: m.expected,
    missing: m.missing.map((r) => customerRow(r, null)),
    failed: m.failed.map(personRow),
    duplicates: m.duplicates.length,
    joined_on_send_day: m.joined.map((r) => customerRow(r, null)),
    new_since_monday: m.new_since,
    skipped_only: m.skipped_only,
    caveat: MONDAY_CAVEAT,
  };

  // refresh
  const st = ctx.status;
  const cov = st && isObj(st.coverage) ? st.coverage : null;
  const g = ctx.g;
  const refresh = {
    ran_at: st ? iso(st.ran_at) : null,
    ok: st && typeof st.ok === "boolean" ? st.ok : null,
    degraded: st && typeof st.degraded === "boolean" ? st.degraded : null,
    fail_kind: failKind(st) || null,
    coverage: cov ? {
      live_sources: num(cov.live_sources), expected_sources: num(cov.expected_sources),
      attempted_sources: num(cov.attempted_sources), lost_sources: num(cov.lost_sources),
      rows: num(cov.rows), disclose: cov.disclose === true,
    } : null,
    count: st && num(st.count) !== null ? st.count : null,
    status_uploaded: inp.statusHead && inp.statusHead.state === "present" ? iso(inp.statusHead.uploaded) : null,
    weekly_uploaded: g.weekly ? iso(g.weekly.uploaded) : null,
    monthly_uploaded: g.monthly ? iso(g.monthly.uploaded) : null,
    portal_uploaded: inp.htmlHead && inp.htmlHead.state === "present" ? iso(inp.htmlHead.uploaded) : null,
    same_bundle_as_last_send: inp.sameBundle === true,
    sources: ctx.triage.sources,
  };

  // sales
  const dl = inp.deliveries;
  let sales = null;
  if (dl && dl.state === "ok" && Array.isArray(dl.value)) {
    const since = now - SALES_DAYS * DAY;
    const recent = dl.value.filter((e) => isObj(e) && ms(e.at) >= since);
    const monthly = recent.filter((e) => e.kind === "monthly");
    sales = {
      new_checkouts: monthly.length,
      renewal_deliveries: recent.filter((e) => e.kind === "weekly").length,
      gross_cents: null, new_subscription_cents: null, pack_cents: null,
      rows: monthly.slice(0, 50).map((e) => {
        const r = byEmail.get(normEmail(e.to));
        return { name: r ? safeName(r.name) : "(not on the roster)", email_masked: maskEmail(e.to),
          t8: r ? t8(r.token) : null, plan: "new checkout", status: null, since: r ? dateOnly(r.since) : null,
          date: dateOnly(iso(e.at)), amount_cents: null, currency: null, stripe_url: r ? stripeUrl(r.customer) : null };
      }),
    };
    if (ctx.usable("invoices_paid") && ctx.usable("sessions")) {
      const s = salesMoney(ctx);
      sales.gross_cents = s.newSub + s.pack;
      sales.new_subscription_cents = s.newSub;
      sales.pack_cents = s.pack;
    }
  }

  const sc = signupCounts(inp.lists, now);
  const signups = sc ? {
    by_day: sc.by_day, trades: sc.trades, prospects: sc.prospects, agents: sc.agents,
    newsletter_new: sc.newsletter, newsletter_confirmed: sc.newsletter_confirmed,
    newsletter_pending: sc.newsletter_pending, at_least: sc.at_least,
  } : null;

  const stripe = ctx.stripe;
  const events = stripe.webhooks && stripe.webhooks.events;
  const setup = {
    stripe: ctx.stripeOn ? "ok" : stripe.state === "refused" ? "refused" : "not-connected",
    price_list: ctx.stripeOn ? "set" : stripe.reason === "price list missing" ? "missing" : "unknown",
    webhook_events: {
      "invoice.payment_failed": events ? events["invoice.payment_failed"] === true : "unknown",
      "customer.subscription.deleted": events ? events["customer.subscription.deleted"] === true : "unknown",
    },
    outreach: inp.outreachHead ? inp.outreachHead.state : "unreadable",
    registry: inp.probeHead && inp.probeHead.state === "present" ? iso(inp.probeHead.uploaded) : null,
  };

  return {
    ok: true, v: 1, now: iso(now),
    signed_in_as: inp.signedInAs || null,
    outreach_edit: inp.outreachEdit === true,
    headline: headlineOf(lines),
    tiles: tileList,
    needs_you: lines,
    detail: {
      customers, renewals, failed_payments: { rows: failedRows }, monday, refresh, sales, signups,
      engagement: engagementCounts(inp.engagement), not_measured: NOT_MEASURED.map((x) => ({ ...x })), setup,
    },
    privacy_redactions: 0,
  };
}

// The walk, the count, and the red line: the last step of both views.
export function finish(payload, isMain) {
  const { payload: out, redactions } = privacyWalk(payload);
  out.privacy_redactions = redactions;
  if (isMain && redactions > 0) {
    out.needs_you = [privacyLine(redactions)].concat(out.needs_you || []);
    out.headline = headlineOf(out.needs_you);
  }
  return out;
}

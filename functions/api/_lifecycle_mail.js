// MassPermits — lifecycle email copy and scheduling (shared module; NOT a route).
//
// Underscore-prefixed like _github-oidc.js, _cf-access.js and _lifecycle.js, so
// Cloudflare Pages never routes it. Imported by functions/api/lifecycle-send.js.
//
// WHY THIS FILE EXISTS
// --------------------
// Four paying customers ever. All four of four made first contact with a
// version of "I paid and I cannot find it" (KB/06 H2). That is a census, not a
// rate. Median time to a first reply was 5.6 days, worst 33.5. The only
// cancellation in company history happened inside a 34-day silence that
// followed a send which genuinely never went out (KB/06 §3).
//
// Four messages, in the order they matter:
//   1. WELCOME    on purchase. Its only job is that they open the product.
//   2. TRADE FIT  day 3. Answers, from our own data, the only real product
//                 question any customer has ever asked us.
//   3. RESCUE     day 14, ONLY if there is no record of them opening it.
//   4. WIN-BACK   30 days after cancellation, and only when we can compute
//                 something that actually changed.
//
// THIS FILE SENDS NOTHING. Every function here is pure: it takes facts and
// returns strings or a plan. All I/O and the send switch live in
// lifecycle-send.js, which is dry-run by default.
//
// FOUR RULES THE COPY OBEYS
// -------------------------
//  1. No number is written by hand. Every figure in every email is computed
//     from data/permits.json via tradefit.json / lifecycle_facts.json, and
//     every one carries the window it was measured over. An asserted
//     comparative between two computed numbers is unfalsifiable, so where a
//     comparison is made the two numbers are both printed.
//  2. A stale fact file is worse than no fact file. A customer cannot tell a
//     number is three weeks old; we can. Past MAX_FACT_AGE_DAYS the numbers are
//     dropped and the email either degrades to its no-numbers variant or is not
//     sent at all.
//  3. Nothing accuses. The Monday email carries the ZIP as an attachment AND
//     the download button, so a subscriber who opens the attachment every week
//     records zero downloads and looks dead. "Never downloaded" means "never
//     used the link" and the rescue copy says so in the customer's own reading
//     order, before it asks anything.
//  4. Never blame a customer for our own miss. planFor() refuses to send the
//     rescue when the lifecycle row says `blame: "us"`. That is the 2026-08-03
//     lesson: a gate exited 1, nothing was sent, the customer asked where it
//     was, and got no reply for 34 days.

// ── constants ───────────────────────────────────────────────────────────────

// Reply-To. Every Resend send in this repo today sets NO reply_to, so every
// "just reply to this email" line resolves to FROM_EMAIL (leads@). The address
// published on 3,099 site pages and in the schema.org Organization block is
// hello@, and three of the four buyers wrote there. Both boxes land in the same
// mailbox and the triage rules already label both as customer mail, so pointing
// replies at the published address costs nothing and matches what a customer
// would do anyway.
export const REPLY_TO = "hello@masspermits.com";

// Sign-off. Deliberately the company, not a person. The operator's stated
// constraint is to stay anonymous until $1K MRR; the cold-outreach queue signs
// with a real name and KB/06 P6 flags that as a decision to take deliberately
// rather than to let a build script take. So this stays neutral, and changing
// it is one line rather than an edit across four templates.
export const SIGNOFF = "MassPermits";
export const SITE = "https://masspermits.com";

// A fact file older than this may not be quoted to a paying customer.
// tradefit_build.py's own docstring states this contract; it is enforced here.
export const MAX_FACT_AGE_DAYS = 10;

// Age windows, in days since `since`. These exist so the FIRST run of this job
// cannot mail the entire back catalogue. Everything outside its window is
// skipped unless the caller passes backfill.
export const WELCOME_MAX_AGE_DAYS = 2;    // a welcome that arrives late is a nag
export const TRADEFIT_MIN_AGE_DAYS = 3;
export const TRADEFIT_MAX_AGE_DAYS = 45;
export const RESCUE_MIN_AGE_DAYS = 14;
export const RESCUE_MAX_AGE_DAYS = 90;

// Cancellation window. Before 30 days it is too soon; after 120 the person has
// moved on and a mail out of nowhere is spam, not a win-back.
export const WINBACK_MIN_DAYS = 30;
export const WINBACK_MAX_DAYS = 120;

// The rescue needs real deliveries behind it. Two cycles is the same warm-up
// _lifecycle.js uses (WARMUP_CYCLES = 2) for the same reason: never accuse a
// subscriber we have not actually watched.
export const RESCUE_MIN_DELIVERED = 2;

// No person gets two lifecycle emails inside this many days, whatever the plan
// says. Belt for the case where two states become true in the same run.
export const MIN_GAP_DAYS = 3;

// The win-back must have something to say. Below this it does not send.
export const WINBACK_MIN_NEW_ROWS = 50;

export const KINDS = ["welcome", "tradefit", "rescue", "winback"];
export const KEY_SENT = "lifecycle/sent.json";

const DAY = 86400_000;

// ── small helpers ───────────────────────────────────────────────────────────

export function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function firstName(name) {
  const n = String(name || "").trim();
  if (!n) return "";
  return n.split(/\s+/)[0];
}

export function daysBetween(aMs, bMs) {
  return (aMs - bMs) / DAY;
}

export function ageDays(sinceYmd, now) {
  const t = Date.parse(String(sinceYmd || "") + "T00:00:00Z");
  return Number.isFinite(t) ? daysBetween(now, t) : null;
}

export function leadsUrl(token, kind) {
  const k = kind === "monthly" ? "&k=monthly" : "";
  return `${SITE}/api/my-leads?t=${token}${k}`;
}

// n formatted with thousands separators, because 2233 in an email reads as a
// typo and 2,233 reads as a measurement.
export function num(n) {
  return Number(n).toLocaleString("en-US");
}

// "Falmouth 95, Sandwich 127" — always the town AND its number, never a bare
// ranking. A ranking asserts a relation between two numbers the reader cannot
// see; printing both lets them check it.
export function pairs(list, max) {
  return (list || []).slice(0, max || 4)
    .map(([t, n]) => `${t} ${num(n)}`).join(", ");
}

// Same, but the unit is spelled out. "Attleboro 398" in a sentence about towns
// reads as an address; "Attleboro (398 permits)" reads as a measurement.
export function pairsUnit(list, max, unit) {
  return (list || []).slice(0, max || 4)
    .map(([t, n]) => `${t} (${num(n)} ${unit})`).join(", ");
}

// "a, b and c". A list joined only with commas reads as a fragment, and these
// are sentences a person is meant to read, not table cells.
export function joinAnd(items) {
  const a = (items || []).filter(Boolean);
  if (a.length <= 1) return a[0] || "";
  if (a.length === 2) return `${a[0]} and ${a[1]}`;
  return `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`;
}

// Names at most `max` of them and counts the rest, because a sentence with
// thirty-nine town names in it is a table someone forgot to format.
export function capList(items, max) {
  const a = (items || []).filter(Boolean);
  if (a.length <= max) return joinAnd(a);
  const rest = a.length - max;
  return `${a.slice(0, max).join(", ")} and ${rest} other${rest === 1 ? "" : "s"}`;
}

// Singular/plural without a template littered with ternaries.
export function areIs(n) { return n === 1 ? "is" : "are"; }

export function ymd(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// "8 August to 6 September" reads like a person wrote it; "2026-08-08..2026-09-06"
// reads like a log line. Year omitted on purpose: both ends are always inside
// the same 30 days, so it adds nothing.
const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
                "August", "September", "October", "November", "December"];
// "2026-09" -> "the start of September". The win-back counts whole months, so
// it must name a month, not a day it did not measure from.
export function monthName(ym) {
  const m = Number(String(ym).slice(5, 7)) - 1;
  return MONTHS[m] ? `the start of ${MONTHS[m]}` : String(ym);
}

export function niceDate(iso) {
  const t = Date.parse(String(iso).slice(0, 10) + "T00:00:00Z");
  if (!Number.isFinite(t)) return String(iso || "");
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

// ── the checkout selection ──────────────────────────────────────────────────
//
// index.html:430 builds client_reference_id as `${TRADE}__${AREA}` with
// /[^a-zA-Z0-9_]/g replaced by "-", so "Flooring/Tile" arrives as
// "Flooring-Tile". Stripe records it on the session; stripe-webhook.js reads it
// into `ref` and today DROPS it. See BUILD_lifecycle.md step 1 for the one-line
// change that persists it. Until that ships, sub.ref is undefined for everyone
// and every trade-fit email takes the no-trade branch, which is why that branch
// is a real email rather than a skip.
//
// Two ways the trade is legitimately absent, both handled rather than guessed:
//   * a referred buyer — refCode() wins the same field, so ref is "ref-<code>"
//   * a buyer who never touched the selectors — ref is "all__all"

export function parseRef(ref, fitKeys) {
  const raw = String(ref || "");
  if (!raw || raw.startsWith("ref-")) return { trade: null, area: null, why: raw ? "referral_code" : "absent" };
  const bits = raw.split("__");
  if (bits.length !== 2) return { trade: null, area: null, why: "unparseable" };
  const [tSlug, area] = bits;
  const trade = unslugTrade(tSlug, fitKeys);
  return {
    trade,
    area: area && area !== "all" ? area : null,
    why: trade ? "ok" : (tSlug === "all" ? "all_trades" : "unknown_trade"),
  };
}

// The slug is lossy ("Flooring/Tile" and "Flooring-Tile" both slug to
// "Flooring-Tile"), so invert it by slugging every known key and matching.
// fitKeys comes from the fact file, not from a copy of the list kept here —
// one definition of which trades exist, in the file that computed them.
export function unslugTrade(slug, fitKeys) {
  const want = String(slug || "");
  if (!want || want === "all") return null;
  for (const k of fitKeys || []) {
    if (k.replace(/[^a-zA-Z0-9_]/g, "-") === want) return k;
  }
  return null;
}

// ── fact selection ──────────────────────────────────────────────────────────
//
// Returns everything the trade-fit email needs, or null. Null is a first-class
// outcome: a stale file, an unknown trade or an empty region all produce null
// and the caller degrades rather than inventing a number.

export function factAgeDays(tradefit, now) {
  const g = tradefit && tradefit.generated;
  const t = Date.parse(g || "");
  return Number.isFinite(t) ? daysBetween(now, t) : null;
}

export function tradeFacts(tradefit, trade, areaKey, now) {
  if (!tradefit || !tradefit.areas) return null;
  const age = factAgeDays(tradefit, now);
  if (age === null || age > MAX_FACT_AGE_DAYS) return null;   // rule 2

  const key = areaKey && tradefit.areas[areaKey] ? areaKey : "all";
  const area = tradefit.areas[key];
  if (!area) return null;
  const fit = trade && area.fits ? area.fits[trade] : null;

  // Description coverage is the reason the two bounds disagree, so it is not an
  // optional footnote. A town that files "RESI." and nothing else cannot be
  // keyword-matched, and without this line the lower bound reads as "there is
  // no work there" instead of "you cannot see the work from here".
  const describedByTown = new Map(area.described_by_town || []);
  const rowsByTown = new Map(area.town_rows || []);
  const blind = [];
  for (const [town, rows] of rowsByTown) {
    if (!describedByTown.get(town)) blind.push([town, rows]);
  }
  blind.sort((a, b) => b[1] - a[1]);

  const base = {
    area_key: key,
    area_label: area.label,
    live_towns: area.live_sources || [],
    window_start: tradefit.window_start,
    window_end: tradefit.window_end,
    window_days: tradefit.window_days,
    rows_window: area.w_all,
    described: area.described,
    described_by_town: area.described_by_town || [],
    town_rows: area.town_rows || [],
    blind_towns: blind,
    blind_rows: blind.reduce((n, [, r]) => n + r, 0),
    monthly_towns: (tradefit.monthly_towns || [])
      .filter((t) => (area.live_sources || []).includes(t)),
    fact_age_days: age,
    generated: tradefit.generated,
  };
  if (!fit) return { ...base, trade: null };

  return {
    ...base,
    trade,
    types: fit.types || [],
    // UPPER bound: permits of the types this trade's work sits inside.
    upper: fit.w,
    upper_by_town: fit.by_town || [],
    by_type: fit.by_type || [],
    // LOWER bound: permits whose own words name the work. null where the
    // taxonomy has a direct label for the trade and a keyword pass adds nothing.
    lower: fit.named,
    lower_by_town: fit.by_town_named || [],
    direct: fit.direct,
  };
}

// The one honest answer to "which town should I look at". Volume ranking and
// description ranking are different orderings and the difference is not noise:
// on the Cape the top two towns by volume file no description at all, so a
// volume answer sends a tile setter to the two towns where a permit cannot tell
// him whether the job is tile. Both orderings are returned; the copy prints
// both and says which is which.
export function bestTowns(f) {
  const byLower = (f.lower_by_town || []).filter(([, n]) => n > 0);
  const byUpper = (f.upper_by_town || []).filter(([, n]) => n > 0);
  const readable = new Set(byLower.map(([t]) => t));
  const volumeOnly = byUpper.filter(([t]) => !readable.has(t));
  return { byLower, byUpper, volumeOnly, disagree: byLower.length > 0 && volumeOnly.length > 0 };
}

// ── win-back facts ──────────────────────────────────────────────────────────
//
// "What has changed since" has to be computed or it must not be claimed.
// Two sources, both verifiable, neither requiring a history we do not have:
//
//   lifecycle_facts.json  — per region, rows by issue-month and per-town
//                           first/last issued_date, straight from permits.json.
//   source-health.json    — per-source first_seen, written by the weekly
//                           refresh. Its history begins the day that file was
//                           created, so a source is only called NEW when its
//                           first_seen is strictly later than the earliest
//                           first_seen in the file. That test is
//                           self-calibrating: on the day the file is created
//                           every source ties for earliest and nothing is new,
//                           which is the truth.

export function winbackFacts(facts, health, areaKey, cancelledYmd, now) {
  if (!facts || !facts.regions) return null;
  const age = factAgeDays(facts, now);
  if (age === null || age > MAX_FACT_AGE_DAYS) return null;

  const key = areaKey && facts.regions[areaKey] ? areaKey : "all";
  const region = facts.regions[key];
  if (!region) return null;

  const cut = String(cancelledYmd || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cut)) return null;

  // The month the cancellation falls in is EXCLUDED, so the copy must say the
  // period it actually counted rather than the cancellation date. Saying
  // "since 2 August" over a number that starts on 1 September understates by a
  // month and is the kind of small lie that costs a reader's trust when they
  // check it.
  const counted_from = firstMonthAfter(region, cut);

  let rows_since = 0;
  const townsSince = [];
  for (const [town, t] of Object.entries(region.towns || {})) {
    const n = countAfter(t.by_month, cut);
    if (n > 0) { rows_since += n; townsSince.push([town, n]); }
  }
  townsSince.sort((a, b) => b[1] - a[1]);

  // A town whose OWN earliest permit in the corpus lands after the cancellation
  // is genuinely new to the file, independent of when we started tracking.
  const new_towns = Object.entries(region.towns || {})
    .filter(([, t]) => t.first && t.first > cut)
    .map(([town]) => town);

  // The health file's opinion, guarded as described above.
  const added = [];
  const seen = Object.entries((health && health.sources) || {})
    .map(([src, h]) => [src, String(h && h.first_seen || "").slice(0, 10)])
    .filter(([, d]) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (seen.length) {
    const earliest = seen.reduce((m, [, d]) => (d < m ? d : m), seen[0][1]);
    for (const [src, d] of seen) {
      if (d > earliest && d > cut) added.push(src.replace(/, MA$/, ""));
    }
  }

  return {
    area_key: key,
    area_label: region.label,
    cancelled: cut,
    counted_from,
    rows_since,
    rows_since_by_town: townsSince,
    new_towns: [...new Set([...new_towns, ...added.filter((t) => region.towns && region.towns[t])])],
    towns_live: Object.keys(region.towns || {}).length,
    window_end: facts.window_end,
    fact_age_days: age,
  };
}

// The earliest month across the region that is strictly after the cut month.
// Null when nothing was counted, in which case the win-back does not send.
function firstMonthAfter(region, cutYmd) {
  const cutMonth = cutYmd.slice(0, 7);
  let best = null;
  for (const t of Object.values(region.towns || {})) {
    for (const m of Object.keys(t.by_month || {})) {
      if (m > cutMonth && (best === null || m < best)) best = m;
    }
  }
  return best;
}

function countAfter(byMonth, cutYmd) {
  // by_month is {"2026-08": n}. A cancellation mid-month means the cut month is
  // only partly "since", so it is EXCLUDED rather than counted whole. The
  // number is therefore a floor, which is the direction an email should err in.
  const cutMonth = cutYmd.slice(0, 7);
  let n = 0;
  for (const [m, c] of Object.entries(byMonth || {})) if (m > cutMonth) n += c;
  return n;
}

// ── did we fail this person while they were paying? ─────────────────────────
//
// The lifecycle classifier only looks at the last 4 cycles, which for a
// cancelled subscriber are all after they left. For the win-back the question
// is about their tenure, so it is computed over the whole retained send log.
//
// feed-send-log.json keeps 12 entries, so this is a FLOOR on our misses, never
// a count. The copy says "at least".

export function missedDuringTenure(sendLog, email, sinceYmd, cancelledYmd) {
  const log = Array.isArray(sendLog) ? sendLog.filter(Boolean) : [];
  if (!log.length || !email) return null;
  const lo = Date.parse(String(sinceYmd || "") + "T00:00:00Z");
  const hi = Date.parse(String(cancelledYmd || "") + "T23:59:59Z");
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  const who = String(email).toLowerCase();

  let runs = 0, delivered = 0, skipped = 0, failed = 0, absent = 0;
  for (const e of log) {
    const t = Date.parse(e && e.at);
    if (!Number.isFinite(t) || t < lo || t > hi) continue;
    runs++;
    if (e.skipped) { skipped++; continue; }
    const row = (Array.isArray(e.sent) ? e.sent : [])
      .find((r) => String((r && r.to) || "").toLowerCase() === who);
    if (!row) absent++;
    else if (row.ok === true) delivered++;
    else failed++;
  }
  if (!runs) return null;
  return { runs, delivered, skipped, failed, absent, missed: skipped + failed + absent };
}

// ── the plan ────────────────────────────────────────────────────────────────
//
// Pure. Decides which single message, if any, is due for one subscriber.
// Returns { kind, reason, ... } with kind null when nothing is due. The reason
// string is what the dry run prints and what the digest explains, so every skip
// is legible rather than being an empty row.

export function planFor(ctx) {
  const { sub, row, now, sent, backfill } = ctx;
  const s = sent || {};
  const age = ageDays(sub.since, now);
  const no = (reason) => ({ kind: null, reason });

  if (!sub || !sub.email) return no("no_email");
  if (!sub.token || !/^[0-9a-f]{32}$/.test(String(sub.token))) return no("no_token");

  // Nothing twice, and nothing on the heels of something else.
  const lastSent = KINDS
    .map((k) => Date.parse(s[k] || ""))
    .filter(Number.isFinite)
    .reduce((m, t) => Math.max(m, t), 0);
  if (lastSent && daysBetween(now, lastSent) < MIN_GAP_DAYS) return no("too_soon_after_last");

  // ---- cancelled: win-back only, and only with something to say -----------
  if (sub.active === false) {
    if (s.winback) return no("winback_already_sent");
    if (!sub.cancelled) return no("cancelled_without_date");
    const d = ageDays(sub.cancelled, now);
    if (d === null) return no("cancelled_date_unparseable");
    if (d < WINBACK_MIN_DAYS) return no(`winback_too_early_${Math.floor(d)}d`);
    if (d > WINBACK_MAX_DAYS) return no(`winback_too_late_${Math.floor(d)}d`);
    const wf = ctx.winback;
    if (!wf) return no("winback_no_facts");
    // Rule: a win-back with nothing computed to report is a nag, not a
    // win-back. It does not send.
    if (wf.rows_since < WINBACK_MIN_NEW_ROWS && !(wf.new_towns || []).length) {
      return no(`winback_nothing_changed_${wf.rows_since}rows`);
    }
    return { kind: "winback", reason: "cancelled_" + Math.floor(d) + "d_ago" };
  }

  // ---- welcome ------------------------------------------------------------
  if (!s.welcome) {
    if (age !== null && (age <= WELCOME_MAX_AGE_DAYS || backfill)) {
      return { kind: "welcome", reason: age <= WELCOME_MAX_AGE_DAYS ? "new_subscriber" : "backfill" };
    }
    if (age === null) return no("since_unparseable");
    // Deliberate fall-through, not a missing return. An existing subscriber
    // does NOT get a "welcome" months late — that reads as if we forgot they
    // were here — but they can still be due a rescue or a trade-fit, so the
    // stages below still run. This is the guard that stops the first run of
    // this job mailing the whole back catalogue.
  }

  // A payment failure is a billing conversation and Stripe is already running
  // its dunning. Do not stack a product email on top of it.
  if (sub.payment_failing) return no("payment_failing");

  // ---- day 14 rescue ------------------------------------------------------
  // Ordered BEFORE trade fit on purpose: if there is no evidence they ever
  // opened it, the useful email is the one that gets them the file, not the one
  // that tells them which towns to look at inside a file they do not have.
  if (!s.rescue && age !== null && age >= RESCUE_MIN_AGE_DAYS &&
      (age <= RESCUE_MAX_AGE_DAYS || backfill)) {
    const r = rescueEligibility(row);
    if (r.ok) return { kind: "rescue", reason: r.reason };
    // not eligible -> fall through to trade fit
  }

  // ---- day 3 trade fit ----------------------------------------------------
  if (!s.tradefit && age !== null && age >= TRADEFIT_MIN_AGE_DAYS &&
      (age <= TRADEFIT_MAX_AGE_DAYS || backfill)) {
    if (!ctx.facts) return no("tradefit_no_facts");
    return { kind: "tradefit", reason: ctx.facts.trade ? "trade_known" : "trade_unknown" };
  }

  if (!s.welcome && age !== null && age > WELCOME_MAX_AGE_DAYS) return no("welcome_window_passed");
  return no("nothing_due");
}

// Split out so the reason for a refusal is testable on its own. Every one of
// these branches is a case where sending would be wrong, not merely unhelpful.
export function rescueEligibility(row) {
  if (!row) return { ok: false, reason: "no_lifecycle_row" };
  if (row.downloads > 0) return { ok: false, reason: "has_downloaded" };
  // blame "us" means the lifecycle rollup found a delivery gap, a never-sent,
  // or a click that hit a missing bundle. Asking that person why they have not
  // opened their file is the 2026-08-03 failure in email form.
  if (row.blame === "us") return { ok: false, reason: "our_delivery_failed" };
  for (const f of ["delivery_gap", "never_sent", "served_no_file"]) {
    if ((row.flags || []).includes(f)) return { ok: false, reason: "flag_" + f };
  }
  if (row.state === "warming") return { ok: false, reason: "warming" };
  if (row.state !== "never-downloaded") return { ok: false, reason: "state_" + row.state };
  if ((row.cycles_delivered_4 || 0) < RESCUE_MIN_DELIVERED) {
    return { ok: false, reason: `only_${row.cycles_delivered_4 || 0}_delivered` };
  }
  return { ok: true, reason: `no_downloads_after_${row.cycles_delivered_4}_deliveries` };
}

// ── the copy ────────────────────────────────────────────────────────────────
//
// Each builder returns { subject, text, html }. Plain text is generated first
// and the HTML is a thin wrapper over the same sentences, so the two can never
// drift and a text-only client sees the whole message. Short lines, no em
// dashes, no exclamation marks, no marketing verbs.

export function render(kind, ctx) {
  switch (kind) {
    case "welcome":  return welcomeEmail(ctx);
    case "tradefit": return tradefitEmail(ctx);
    case "rescue":   return rescueEmail(ctx);
    case "winback":  return winbackEmail(ctx);
    default: throw new Error("unknown lifecycle kind: " + kind);
  }
}

function hi(sub) {
  const f = firstName(sub.name);
  return f ? `Hi ${f},` : "Hi,";
}

// 1. WELCOME ─────────────────────────────────────────────────────────────────
// Sent on purchase. Its whole job is that they open the product, and the one
// thing it must do that the bundle email cannot is ARRIVE: it carries no
// attachment. A 1 to 2 MB ZIP from a young sending domain is the single biggest
// spam trigger this business controls (my-leads.js:4-6), and it is what
// quarantined the product for the two customers who bought in late August.
// Everything else here is the answer to a question a real customer asked in
// writing: "I was wondering if there is a sign in".
function welcomeEmail(ctx) {
  const { sub } = ctx;
  const url = leadsUrl(sub.token, "monthly");
  const lines = [
    hi(sub),
    "",
    "Thanks for subscribing. This email has no attachment, so it should reach you even if the one carrying the file does not.",
    "",
    "Your link:",
    url,
    "",
    "That link is your account. There is no login and no password. It always serves the current file, so it keeps working every week. Bookmark it.",
    "",
    "Open the zip and start with MassPermits-Leads.html. That is the dashboard: search and filter by trade and town, sort by project value, look up a contractor's active jobs. The CSVs are in there too, one master file and one per trade.",
    "",
    "If the link does not work, or the zip will not open on your phone, reply to this email and I will send you the file directly in whatever form is easiest.",
    "",
    SIGNOFF,
  ];
  return wrap({
    subject: "Your MassPermits link, and how to open it",
    lines,
    button: { href: url, label: "Open your leads" },
  });
}

// 2. DAY 3 TRADE FIT ─────────────────────────────────────────────────────────
// On 2026-07-23 the most engaged customer this business has had asked "what
// area would be the best to look for potential tile installation projects?"
// It was answered by hand, six days late, in one email, and never written down.
// He cancelled five weeks later. This is that answer, computed, on a schedule.
//
// The honest structure is forced by the data and not by a template:
//   - there is no permit type for most finish trades, so the count of permits
//     "of the types the work sits inside" is an UPPER bound
//   - the count of permits whose own words name the work is a LOWER bound
//   - the gap between them is mostly description coverage, not absence of work
// Print all three or the number is a lie by omission.
function tradefitEmail(ctx) {
  const { sub, facts } = ctx;
  const f = facts;
  const win = `${niceDate(f.window_start)} to ${niceDate(f.window_end)}`;
  const L = [hi(sub), ""];

  if (!f.trade) {
    // No trade on file. Still worth sending: the region numbers are real and
    // useful, and the question at the end is how we learn the trade at all.
    // Three of four buyers were never asked anything (KB/06 P4).
    L.push(`Quick note on where to look in the file you are getting. All of this is the last ${f.window_days} days, ${win}.`);
    L.push("");
    L.push(`${f.area_label} had ${num(f.rows_window)} permits in that window across ${f.live_towns.length} towns. The busiest, by permit count, were ${pairs(f.town_rows, 5)}.`);
    L.push("");
    L.push(`One thing worth knowing before you dig. ${num(f.described)} of those ${num(f.rows_window)} permits carry a real description of the work. The rest file a code and nothing else, so you cannot tell what the job is without calling.`);
    if (f.blind_towns.length) {
      L.push("");
      L.push(`Towns that file no description at all, with their 30-day counts: ${pairs(f.blind_towns, 4)}. Those are real jobs, you just cannot read them.`);
    }
    if (f.monthly_towns.length) {
      L.push("");
      L.push(`${capList(f.monthly_towns, 4)} ${f.monthly_towns.length === 1 ? "publishes" : "publish"} monthly, so those permits arrive in a batch rather than every week.`);
    }
    L.push("");
    L.push("What trade are you? Reply with one word and I will send you the same breakdown for the permit types your work actually sits inside, for your towns. It takes me a minute and it is the question I get asked most.");
  } else {
    const b = bestTowns(f);
    const typeList = f.types.join(", ");
    L.push(`You picked ${f.trade} in ${f.area_label}, so here is where the work actually is. All of this is the last ${f.window_days} days, ${win}.`);
    L.push("");

    const onlyItself = f.types.length === 1 && f.types[0] === f.trade;
    if (f.direct > 0 && onlyItself) {
      // The trade IS the permit label and nothing else counts. One number.
      L.push(`${f.area_label} filed ${num(f.direct)} ${f.trade} permits in that window.`);
    } else if (f.direct > 0) {
      L.push(`${f.area_label} filed ${num(f.direct)} permits under ${f.trade} itself in that window, and ${num(f.upper)} across the wider set your work sits inside: ${joinAnd(f.types)}.`);
    } else {
      L.push(`There is no ${f.trade} permit. Towns do not file one. That work sits inside other permit types: ${joinAnd(f.types)}. In ${f.area_label} that was ${num(f.upper)} permits.`);
    }
    if (f.upper_by_town.length) {
      L.push("");
      L.push(`By town: ${pairs(f.upper_by_town, 5)}.`);
    }

    if (f.lower != null) {
      // A trade the permit taxonomy cannot see. Both bounds, and the reason
      // they disagree, or the number means nothing.
      L.push("");
      L.push(`That ${num(f.upper)} is the outside number. It counts the permit types your work sits in, not permits that contain your work. A gut remodel is in there and so is a window replacement.`);
      L.push("");
      L.push(`The inside number is ${num(f.lower)}. Those are the permits whose own description names the work.`);
      if (b.byLower.length) L.push(`By town: ${pairs(b.byLower, 5)}.`);
      L.push("");
      L.push(`The gap between ${num(f.upper)} and ${num(f.lower)} is mostly not missing work. It is missing words. ${num(f.described)} of ${num(f.rows_window)} permits in ${f.area_label} say what the job is. The rest file a code and stop.`);
      if (b.disagree) {
        const vol = joinAnd(b.volumeOnly.slice(0, 2).map(([t, n]) => `${t} (${num(n)})`));
        const read = joinAnd(b.byLower.slice(0, 2).map(([t, n]) => `${t} (${num(n)})`));
        const readN = Math.min(2, b.byLower.length);
        L.push("");
        L.push(`That changes the answer. By raw volume the biggest towns are ${vol}. Those towns write no description, so nothing in them can be identified as your work before you pick up the phone. ${read} ${areIs(readN)} where you can read a permit and know what the job is.`);
        L.push("");
        L.push(`So: ${b.byLower[0][0]} first, because you can tell what you are calling about. ${b.volumeOnly[0][0]} second, on volume, knowing you are calling blind.`);
      } else if (b.byLower.length) {
        L.push("");
        L.push(`Best town to start: ${b.byLower[0][0]}, with ${num(b.byLower[0][1])} of the ${num(f.lower)}.`);
      }
    } else if (b.byUpper.length) {
      // A trade the towns DO file under its own label. The count is exact, so
      // there is no second bound to print. The caveat that still matters is
      // whether you can tell anything about the job before you call.
      L.push("");
      L.push(`Those counts are exact. ${f.trade} is one of the labels towns actually file under, so this is not an estimate.`);
      L.push("");
      L.push(`Start with ${b.byUpper[0][0]}, at ${num(b.byUpper[0][1])} of the ${num(f.upper)}. One caveat before you call: ${num(f.described)} of ${num(f.rows_window)} permits in ${f.area_label} carry a real description of the work, so for the rest you get the address and the type and nothing else.`);
    }

    if (f.monthly_towns.length) {
      L.push("");
      L.push(`${capList(f.monthly_towns, 4)} ${f.monthly_towns.length === 1 ? "publishes" : "publish"} monthly, so a quiet week there is the schedule and not the market. Those permits arrive in a batch.`);
    }
    L.push("");
    L.push("Did I get your trade right? If you are more one than the other, reply and I will run the same numbers for whichever it is.");
  }

  L.push("");
  L.push("Your link, if you need it again:");
  L.push(leadsUrl(sub.token));
  L.push("");
  L.push(SIGNOFF);

  return wrap({
    subject: f.trade
      ? `Where the ${f.trade} work is in ${f.area_label}`
      : `Where to look in ${f.area_label}`,
    lines: L,
  });
}

// 3. DAY 14 NO-DOWNLOAD RESCUE ───────────────────────────────────────────────
// Short, human, and it offers to just send the file. It names the attachment
// confound in the FIRST paragraph, before it asks anything, because the metric
// genuinely cannot see an attachment user and an email that opens with an
// accusation it cannot support is worse than no email.
function rescueEmail(ctx) {
  const { sub, row } = ctx;
  const n = row && row.cycles_delivered_4 ? row.cycles_delivered_4 : 0;
  const files = n === 1 ? "one weekly file" : `${n} weekly files`;
  const L = [
    hi(sub),
    "",
    `You have had ${files} from us and I have no record of the download link being used. That may well mean nothing. The file is attached to every email as well, and opening the attachment does not show up on my side.`,
    "",
    "But if it has not been working, I would rather know than guess.",
    "",
    "If the zip never arrived, or it will not open, reply to this and I will send you the file directly. I can send the dashboard as a single web page, or just the CSV, whichever is easier.",
    "",
    "Your link:",
    leadsUrl(sub.token),
    "",
    "If you are opening the attachment every week and it is all fine, ignore this and I will stop counting.",
    "",
    SIGNOFF,
  ];
  return wrap({
    subject: "Have you been able to open it?",
    lines: L,
    button: { href: leadsUrl(sub.token), label: "Open this week's leads" },
  });
}

// 4. WIN-BACK ────────────────────────────────────────────────────────────────
// 30 days after cancellation. Two rules, both from the record rather than from
// taste:
//   - No discount. Nothing in company history says price caused a lapse. The
//     one cancellation followed a missed send and 34 days of silence.
//   - Say what we got wrong, plainly, and only when the send log says we did.
//     missedDuringTenure() computes it; the copy does not assume it.
// It sends only when there is something computed to report, so the body always
// has a fact in it and never reads as "please come back".
function winbackEmail(ctx) {
  const { sub, winback: w, tenure } = ctx;
  const L = [hi(sub), ""];

  if (tenure && tenure.missed > 0) {
    const runs = tenure.runs === 1 ? "the one send" : `the ${tenure.runs} sends`;
    L.push(`You cancelled on ${niceDate(sub.cancelled)}. Looking back at the log, ${tenure.missed} of ${runs} we have on record for your subscription did not reach you. That is on us and not on you, and I am sorry it took a cancellation for anyone to go and look.`);
  } else {
    L.push(`You cancelled on ${niceDate(sub.cancelled)}. No pitch. Just what has changed in the data since, in case it matters.`);
  }
  L.push("");

  // The counted period, not the cancellation date. The month the cancellation
  // fell in is excluded from the count, so quoting the cancellation date over
  // this number would overstate the period and understate the rate.
  const from = w.counted_from ? monthName(w.counted_from) : niceDate(w.cancelled);
  L.push(`Since ${from}, ${num(w.rows_since)} new permits have landed in ${w.area_label}.`);
  if (w.rows_since_by_town.length) {
    L.push(`By town: ${pairs(w.rows_since_by_town, 5)}.`);
  }
  if ((w.new_towns || []).length) {
    L.push("");
    L.push(`In the file now and not in it when you left: ${joinAnd(w.new_towns)}.`);
  }
  L.push("");
  L.push("Two things changed on our side as well. Every purchase email now leads with a download link instead of relying on the attachment reaching you, and there is a watchdog on the Monday send, so a week that does not go out gets caught the same day rather than by you.");
  L.push("");
  L.push("No discount and no offer. The same page is there if you want back in. If you do not, one line telling me what actually went wrong would be worth more to me than the subscription.");
  L.push("");
  L.push(SIGNOFF);

  return wrap({
    subject: `What has changed in ${w.area_label} since you left`,
    lines: L,
  });
}

// ── the run ─────────────────────────────────────────────────────────────────
//
// The whole per-subscriber loop, with I/O injected. lifecycle-send.js is a thin
// adapter that reads R2, calls this, and passes a `send` that talks to Resend;
// the local dry run calls the SAME function with a `send` that throws if it is
// ever reached. That is what makes "dry run sends nothing" a proven property of
// the shipped code path rather than a claim about a second copy of it.
//
// Same split _lifecycle.js already uses: rollup() is pure, runRollup() does the
// I/O. Nothing here reads or writes anything on its own.
//
//   deps.send(email, mail)      -> Promise. MUST NOT be called when live=false.
//   deps.checkpoint(t8, kind)   -> Promise. Called immediately after each send.
//
// Returns counts only. No email, name, token or token prefix is in the result,
// because the caller's caller is a workflow in a public repo whose logs are
// world-readable.
export async function runLifecycle(input, deps) {
  const {
    subs = [], sendLog = [], health = null, lifecycle = null,
    tradefit = null, facts = null, sent = {},
    now = Date.now(), live = false, backfill = false, only = "",
    maxSends = 10, rowForToken: findRow,
  } = input;

  const fitKeys = tradefitKeys(tradefit);
  const planned = Object.fromEntries(KINDS.map((k) => [k, 0]));
  const delivered = Object.fromEntries(KINDS.map((k) => [k, 0]));
  const reasons = {};
  const bump = (r) => { reasons[r] = (reasons[r] || 0) + 1; };
  const previews = [];        // rendered copy, returned to the LOCAL caller only
  let considered = 0, errors = 0, renderedN = 0, capped = 0, checkpoints = 0;
  const totalSent = () => KINDS.reduce((n, k) => n + delivered[k], 0);

  for (const sub of subs || []) {
    if (!sub || !sub.email) { bump("no_email"); continue; }
    considered++;

    const t8 = String(sub.token || "").slice(0, T8);
    const state = (t8 && sent[t8]) || {};
    const row = findRow ? findRow(lifecycle, sub.token) : null;
    const sel = parseRef(sub.ref, fitKeys);

    const ctx = {
      sub, row, now, backfill, selection: sel,
      sent: state,
      facts: tradeFacts(tradefit, sel.trade, sel.area, now),
      winback: sub.active === false
        ? winbackFacts(facts, health, sel.area, sub.cancelled, now) : null,
      tenure: sub.active === false
        ? missedDuringTenure(sendLog, sub.email, sub.since, sub.cancelled) : null,
    };

    const plan = planFor(ctx);
    if (!plan.kind) { bump(plan.reason); continue; }
    if (only && plan.kind !== only) { bump("filtered_out_by_only"); continue; }
    planned[plan.kind]++;
    bump(plan.kind + ":" + plan.reason);

    // Render ALWAYS, including on a dry run. Rendering is where a missing fact
    // or a bad template blows up, and a dry run that skips it proves nothing
    // about the live run it stands in for.
    let mail;
    try {
      mail = render(plan.kind, ctx);
      renderedN++;
      previews.push({ t8, kind: plan.kind, reason: plan.reason, selection: sel, mail });
    } catch (e) {
      errors++; bump("render_failed:" + String((e && e.message) || e).slice(0, 60));
      continue;
    }

    if (!live) continue;                       // <- the entire switch, one line
    if (totalSent() >= maxSends) { capped++; continue; }

    try {
      await deps.send(sub.email, mail);
      delivered[plan.kind]++;
    } catch (e) {
      errors++; bump("send_failed");
      continue;                                // no checkpoint: retry next run
    }
    // Checkpoint IMMEDIATELY after the send, per message, the way
    // nurture.js does (its put lands immediately after each send), so a crash
    // or an Actions retry can never re-send a
    // whole batch. Narrow stated failure mode: if the checkpoint write fails,
    // that ONE message can repeat on the next run. MIN_GAP_DAYS bounds it to
    // once.
    try {
      if (t8) { await deps.checkpoint(t8, plan.kind); checkpoints++; }
    } catch (_) { errors++; bump("checkpoint_failed"); }
  }

  return {
    counts: {
      mode: live ? "SEND" : "dry-run",
      subscribers: (subs || []).length,
      considered, planned, sent: delivered,
      rendered: renderedN, capped, errors, checkpoints, reasons,
      have_lifecycle: !!lifecycle, have_tradefit: !!tradefit, have_facts: !!facts,
      tradefit_age_days: round1(factAgeDays(tradefit, now)),
      facts_age_days: round1(factAgeDays(facts, now)),
      at: new Date(now).toISOString(),
    },
    // NEVER put this in an HTTP response. Every preview carries a subscriber's
    // private download link in full. It exists so the local dry run can print
    // the copy for a human to read before anything is ever sent.
    previews,
  };
}

const T8 = 8;
function round1(n) { return n === null || n === undefined ? null : Math.round(n * 10) / 10; }

// The list of stated trades comes from the file that computed them, not from a
// second copy kept here. Missing fact file means every subscriber takes the
// no-trade branch rather than the wrong-trade branch.
export function tradefitKeys(tradefit) {
  try {
    const a = tradefit && tradefit.areas &&
      (tradefit.areas.all || Object.values(tradefit.areas)[0]);
    return a && a.fits ? Object.keys(a.fits) : [];
  } catch { return []; }
}

// ── the wrapper ─────────────────────────────────────────────────────────────
// One layout for all four. Deliberately plain: no logo, no banner, no coloured
// panel. These are meant to read as mail from a person, and the templated look
// of the existing bundle emails is part of what makes them look like something
// to file rather than answer. A bare URL is printed as text as well as being a
// button, because a stripped button leaves nothing behind.
function wrap({ subject, lines, button }) {
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  const body = lines.map((ln) => {
    if (ln === "") return "";
    if (/^https:\/\//.test(ln)) {
      return `<p style="margin:0 0 12px;word-break:break-all"><a href="${esc(ln)}" style="color:#0e7c6b">${esc(ln)}</a></p>`;
    }
    return `<p style="margin:0 0 12px">${esc(ln)}</p>`;
  }).join("");
  const btn = button
    ? `<p style="margin:18px 0"><a href="${esc(button.href)}" style="background:#0e7c6b;color:#fff;font-weight:700;padding:11px 20px;border-radius:8px;text-decoration:none;display:inline-block">${esc(button.label)}</a></p>`
    : "";
  const html =
    `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:520px;color:#0e1622;font-size:15px;line-height:1.5">` +
    body + btn +
    `<p style="color:#9aa;font-size:12px;margin-top:24px">masspermits.com &middot; public municipal building-permit records</p></div>`;
  return { subject, text, html };
}

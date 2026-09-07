// MassPermits — subscriber lifecycle signals (shared module; NOT a route).
//
// Underscore-prefixed, like _github-oidc.js and _cf-access.js, so Cloudflare
// Pages never routes it. It is imported by functions/api/engagement.js and is
// safe to import from the Access-gated admin surface.
//
// WHAT THIS ANSWERS, AND WHY IT DID NOT EXIST BEFORE
// -------------------------------------------------
// Until now the business could prove it SENT the product (feed-send-log.json)
// and that Resend ACCEPTED it (delivery-log.json). It could not prove anybody
// ever USED it. /api/my-leads serves the product against a per-subscriber
// token, so a download is already attributable to one paying customer — it was
// simply never recorded. This module turns those recorded fetches, plus the
// billing fields the Stripe webhook already writes, into one state per
// subscriber.
//
// THE ONE THING THIS FILE MUST NEVER DO
// -------------------------------------
// No email address, no name, no IP, no full token leaves rollup() in `rows`,
// `counts` or `response`. The join key is the first 8 hex of the download token
// — 32 bits of a 128-bit secret, unguessable, and already the key the download
// log writes. Emails exist inside rollup() only long enough to join
// feed-send-log.json, and appear in exactly one output: `digest`, which
// engagement.js mails to the owner's own inbox and nowhere else.
//
// `response` is the harder constraint: send-watchdog.yml runs in a PUBLIC repo
// and pipes endpoint responses through `jq .` into a world-readable Actions
// log. So `response` carries COUNTS ONLY — not even a t8.
//
// TWO AXES, ONE STATE
// -------------------
// BILLING comes from subscribers.json fields written by the Stripe webhook
// (`active`, `cancelled`, `payment_failing`). ENGAGEMENT comes from the dl/
// event log. They are independent: a customer can be paying and dead, or
// cancelled and still clicking. `state` is the single label that collapses
// them, billing first, because a cancelled customer is not a retention
// question.
//
// PRECEDENCE (disjoint and total):
//   cancelled > payment-failing > unattributable > warming
//             > never-downloaded > lapsed > healthy
//
// `warming` outranks the two accusing states on purpose. On the first run of
// this metric every subscriber has zero downloads; without the warm-up the
// first digest tells three paying customers they have been ignoring a product
// nobody was measuring. A late signal is cheaper than a false accusation.

// ── cycle arithmetic ────────────────────────────────────────────────────────
// A cycle is a DELIVERY WEEK, not a rolling 7 days. Anchored to the same
// Monday 12:00 UTC send-status.js uses (SEND_DOW = 1, SEND_HOUR = 12) so the
// two surfaces can never disagree about which week a thing happened in.
export const SEND_DOW = 1;
export const SEND_HOUR = 12;
export const CYCLE_MS = 7 * 86400_000;

// ── thresholds ──────────────────────────────────────────────────────────────
// Every one of these is a judgement call. The reason is on the line.
export const DEDUPE_MS = 10 * 60_000;   // a double-click is one download, not two
export const LAPSE_DAYS = 21;           // 3 missed cycles. The only churn in company
                                        // history went 34 days silent and cancelled
                                        // inside that silence: this fires 13 days early.
export const WARMUP_CYCLES = 2;         // never accuse a subscriber we have not watched
export const ENGAGED_OF_4 = 3;          // allows one holiday week without losing the label
export const RETAIN_DAYS = 400;         // a full year of comparison, then delete
export const MACHINE_WINDOW_MS = 120_000; // a fetch this close to the send is a link scanner
export const DUNNING_MAX_DAYS = 30;     // see dunning_stale below
export const T8_LEN = 8;                // join-key length; go to 12 past ~15 subscribers
export const PRUNE_MAX_PER_RUN = 200;   // bounded delete, so retention cannot blow the
                                        // Workers subrequest budget in one run

// FLOOR ONLY. The effective value is max(this, whatever is already stored in
// engagement.json), and on the very first run with nothing stored it becomes
// that day's date. Moving it FORWARD is always safe (fewer observed cycles =
// more conservative). Moving it BACKWARD makes historical subscribers look
// like they ignored a product that was not yet measured, so the max() below
// makes that impossible rather than leaving it to discipline.
export const INSTRUMENTED_AT_FLOOR = "2026-09-08";

export const STATES = ["cancelled", "payment-failing", "unattributable",
                       "warming", "never-downloaded", "lapsed", "healthy"];

// Most recent Monday 12:00 UTC at or before `now`. Copied from send-status.js
// deliberately: one cadence, one anchor, in two files that must agree.
export function lastDueAt(now) {
  const d = new Date(now);
  d.setUTCHours(SEND_HOUR, 0, 0, 0);
  const back = (d.getUTCDay() - SEND_DOW + 7) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  if (d.getTime() > now) d.setUTCDate(d.getUTCDate() - 7);
  return d.getTime();
}

// 0 = the current, incomplete cycle. 1 = last completed delivery week.
// Signals are judged on 1..4 only: the rollup runs 90 minutes after the send
// and nobody has had time to open cycle 0 yet.
//
// CEIL, NOT floor()+1. A cycle is the half-open interval
// [dueAt - n*CYCLE, dueAt - (n-1)*CYCLE), so a timestamp landing exactly on a
// boundary belongs to the cycle that STARTS there. floor()+1 — which is what
// ENGAGEMENT.md's reference dry run carries — puts it in the cycle before,
// shifting that subscriber's whole delivery history by one week and inventing
// a `delivery_gap` in cycle 1 out of nothing. It only diverges on the exact
// boundary, which is why it survived a dry run whose events were all an hour
// after the send. Real feed-send-log `at` values sit seconds after 12:00:00,
// so this was one runner-timing coincidence away from mattering.
export function cycleIndex(ts, dueAt) {
  if (ts >= dueAt) return 0;
  return Math.ceil((dueAt - ts) / CYCLE_MS);
}

export function t8of(token) {
  return String(token || "").slice(0, T8_LEN);
}

const day = (ms) => ms / 86400_000;
const iso = (ms) => new Date(ms).toISOString();

// ── the classifier ──────────────────────────────────────────────────────────
// Pure. Takes one subscriber's already-computed facts, returns its labels.
// Exported on its own so the admin dashboard can re-derive a row without
// re-running the rollup, and so the dry run can drive it directly.
export function classifyRow(f) {
  const flags = [];
  let engagement, state, blame = "them", action = "none";

  // --- engagement axis (download events only) ---
  if (f.collided)                               engagement = "unattributable";
  else if (f.observed_cycles < WARMUP_CYCLES)   engagement = "warming";
  else if (f.downloads === 0)                   engagement = "never";
  else if (f.days_since_download > LAPSE_DAYS)  engagement = "lapsed";
  else if (f.cycles_hit_4 >= ENGAGED_OF_4)      engagement = "engaged";
  else                                          engagement = "casual";

  // --- billing axis (subscribers.json fields the Stripe webhook writes) ---
  let billing = "active";
  if (f.active === false) billing = "cancelled";
  else if (f.payment_failing) billing = "payment_failing";

  // --- did WE fail them? This is step one, not step three. ---
  // On 2026-08-03 a gate exited 1, the upload step was skipped, nothing was
  // sent, the customer asked where it was, and got no reply for 34 days. He
  // cancelled inside that silence. Any absence signal that does not check
  // delivery first is capable of blaming a customer for our own miss, so the
  // check is encoded here rather than left in a runbook.
  //
  // ONLY for a subscriber we are still supposed to be mailing. A cancelled row
  // is absent from the send log because weekly-send.js:65 filters on
  // `active !== false` — that is the system working, not a delivery failure,
  // and reporting it as one buries the real ones.
  if (f.active !== false) {
    if (f.have_send_log && f.cycles_missing_4 > 0) {
      flags.push("delivery_gap");
      blame = "us";
    }
    if (f.have_send_log && f.cycles_delivered_4 === 0 && f.cycles_due_4 > 0) {
      flags.push("never_sent");
      blame = "us";
    }
    if (!f.have_send_log) blame = "unknown";
  }
  if (f.cycles_no_product_4 > 0) flags.push("skipped_cycle");
  // A subscriber with fewer than 4 real deliveries behind them cannot reach
  // ENGAGED_OF_4 on merit. The threshold is not lowered — that would inflate
  // the label — but the row says so, so nobody reads "casual" as a verdict.
  if (f.cycles_delivered_4 < 4) flags.push("low_opportunity");
  if (f.machine_suspect > 0) flags.push("machine_suspect");
  // A cancelled customer still clicking their old link is a win-back signal,
  // not noise. /api/my-leads 403s them, so this is the only place it shows up.
  if (f.active === false && f.inactive_clicks > 0) flags.push("winback_signal");
  // A subscriber clicked and the bundle was not in R2. That is our failure and
  // it is invisible from every other surface: no send failed, no log recorded
  // it, and the customer saw a 404 where their product should have been.
  if (f.no_file > 0) { flags.push("served_no_file"); blame = "us"; }

  // dunning_stale is the STRIPE_AUDIT §5 leak made visible from our own data.
  // invoice.payment_failed sets payment_failing and DELIBERATELY does not stop
  // delivery, on the stated assumption that Stripe ends dunning with
  // customer.subscription.deleted. That is only true if Stripe's "if all
  // retries fail" setting is "Cancel the subscription". Under the other two
  // settings the event never fires, the row stays active:true, and the $99/mo
  // product ships forever, unpaid. A payment_failing date older than Stripe's
  // whole retry schedule with the row still active is that leak's signature.
  if (f.payment_failing_days !== null && f.payment_failing_days > DUNNING_MAX_DAYS
      && f.active !== false) {
    flags.push("dunning_stale");
  }

  // --- the single state, billing first ---
  if (billing === "cancelled")            state = "cancelled";
  else if (billing === "payment_failing") state = "payment-failing";
  else if (engagement === "unattributable") state = "unattributable";
  else if (engagement === "warming")      state = "warming";
  else if (engagement === "never")        state = "never-downloaded";
  else if (engagement === "lapsed")       state = "lapsed";
  else                                    state = "healthy";

  // --- the first thing to do about it ---
  // ENGAGEMENT.md §9's trigger table, encoded, so the ordering survives being
  // read by a human in a hurry.
  if (state === "cancelled") {
    action = flags.includes("winback_signal") ? "winback" : "none";
  } else if (state === "payment-failing") {
    action = flags.includes("dunning_stale") ? "check_dunning_endstate" : "watch_stripe";
  } else if (state === "unattributable") {
    action = "lengthen_join_key";
  } else if (state === "warming") {
    action = "none";
  } else if (blame === "us") {
    action = "fix_delivery_first";
  } else if (state === "never-downloaded") {
    action = "ask_how_they_use_it";
  } else if (state === "lapsed") {
    action = "contact_48h";
  } else if (engagement === "engaged" && f.cycles_hit_4 >= 4) {
    action = "ask_referral";
  }

  return { engagement, billing, state, blame, action, flags };
}

// ── the rollup ──────────────────────────────────────────────────────────────
// Pure: takes already-read data, returns everything. All I/O lives in
// runRollup() below, so this function is exhaustively testable in node with no
// Cloudflare runtime present.
//
// RECOMPUTES FROM SCRATCH EVERY RUN. An incremental counter needs a watermark,
// and a watermark that slips double-counts or drops events silently. At 3
// active subscribers the event log grows ~150 objects a year; even at 50 it is
// ~2,600, which is three list() pages. There is no volume argument for taking
// that risk.
export function rollup({ subs, events, sendLog, now, instrumentedAt, prev }) {
  const dueAt = lastDueAt(now);
  const instrMs = Date.parse(instrumentedAt + "T00:00:00Z");
  const list = Array.isArray(subs) ? subs.filter(Boolean) : [];
  const log = Array.isArray(sendLog) ? sendLog.filter(Boolean) : [];
  const have_send_log = log.length > 0;

  // Join key. A collision would silently merge two customers' behaviour, which
  // is worse than reporting nothing, so both rows are marked and excluded.
  // Cannot happen below a few thousand subscribers; checked rather than assumed.
  const seen = new Set();
  const collided = new Set();
  for (const s of list) {
    const t8 = t8of(s.token);
    if (!t8) continue;
    if (seen.has(t8)) collided.add(t8); else seen.add(t8);
  }

  // Send timestamps, used twice: to decide which cycle a delivery landed in,
  // and to flag fetches that land within seconds of it as scanner-shaped.
  const sendTimes = [];
  for (const e of log) {
    const t = Date.parse(e && e.at);
    if (Number.isFinite(t)) sendTimes.push(t);
  }
  const nearSend = (ts) => sendTimes.some((t) => Math.abs(ts - t) <= MACHINE_WINDOW_MS);

  // ---- bucket the events ----
  const per = new Map();
  const seed = (t8) => {
    if (!per.has(t8)) per.set(t8, { hits: [], machine: 0, inactive: 0, no_file: 0 });
    return per.get(t8);
  };
  let unmatched_403 = 0, inactive_403 = 0, no_file_total = 0, machine_total = 0;
  let unmatched_403_28d = 0, malformed_events = 0;
  // The event log keeps 400 days, so a lifetime 403 count only ever rises and
  // stops meaning anything. The 28-day figure is the one to read.
  const recent = (ts) => now - ts < 28 * 86400_000;

  for (const ev of events || []) {
    const m = (ev && ev.customMetadata) || {};
    // The timestamp lives in the key, so it is never stored twice.
    const tail = String((ev && ev.key) || "").split("/").pop() || "";
    const ts = Number(tail.split("-")[0]);
    if (!Number.isFinite(ts)) { malformed_events++; continue; }

    if (m.r === "no_match") {                                 // nobody to attribute to
      unmatched_403++; if (recent(ts)) unmatched_403_28d++; continue;
    }
    const t8 = m.t ? String(m.t).slice(0, T8_LEN) : "";
    if (!t8) { malformed_events++; continue; }

    if (m.r === "inactive") { inactive_403++; seed(t8).inactive++; continue; }
    if (m.r === "no_file")  { no_file_total++; seed(t8).no_file++; continue; }

    // machine_suspect is derived HERE, not at write time. Deciding it in
    // my-leads.js would need a second R2 read on the customer's download path.
    // Two independent tests, neither sufficient alone: the bot regex already
    // ran at write time, and this one catches a scanner that presents a
    // browser UA by its timing.
    if (m.m === "1" || nearSend(ts)) { machine_total++; seed(t8).machine++; continue; }
    seed(t8).hits.push({ ts, dev: m.d || "?" });
  }

  // ---- per-subscriber delivery history, joined on email IN MEMORY ONLY ----
  // The email never leaves this function. cycleState[email][cycle] is built
  // once, then read by t8.
  const deliveryByEmail = new Map();
  for (const e of log) {
    const t = Date.parse(e && e.at);
    if (!Number.isFinite(t)) continue;
    const c = cycleIndex(t, dueAt);
    if (c < 1 || c > 4) continue;
    const skipped = !!e.skipped;
    const sent = Array.isArray(e.sent) ? e.sent : [];
    if (skipped || !sent.length) {
      // The run happened and mailed nobody. send-status.js calls this
      // stale_bundle: not a delivery, and not the subscriber's fault either —
      // there was no new product that week to download.
      for (const s of list) {
        const k = (s.email || "").toLowerCase();
        if (!k) continue;
        const rec = deliveryByEmail.get(k) || {};
        if (!rec[c]) rec[c] = "skipped";
        deliveryByEmail.set(k, rec);
      }
      continue;
    }
    for (const r of sent) {
      const k = String((r && r.to) || "").toLowerCase();
      if (!k) continue;
      const rec = deliveryByEmail.get(k) || {};
      // A later (newer) entry for the same cycle wins only if it is better:
      // one delivered send in a cycle means they got it.
      if (r.ok === true) rec[c] = "delivered";
      else if (rec[c] !== "delivered") rec[c] = "failed";
      deliveryByEmail.set(k, rec);
    }
  }

  const prevByT8 = new Map();
  for (const r of (prev && Array.isArray(prev.rows) ? prev.rows : [])) {
    if (r && r.t8) prevByT8.set(r.t8, r);
  }

  const rows = [];
  const transitions = [];
  const counts = Object.fromEntries(STATES.map((s) => [s, 0]));

  for (const s of list) {
    const t8 = t8of(s.token);
    const p = per.get(t8) || { hits: [], machine: 0, inactive: 0, no_file: 0 };

    // Dedupe: a customer who clicks twice because the first download did not
    // obviously start is one download.
    const raw = p.hits.slice().sort((a, b) => a.ts - b.ts);
    const hits = [];
    for (const h of raw) {
      if (!hits.length || h.ts - hits[hits.length - 1].ts > DEDUPE_MS) hits.push(h);
    }

    const startMs = Math.max(Date.parse((s.since || "1970-01-01") + "T00:00:00Z") || 0, instrMs);
    const observed_cycles = Math.max(0, Math.floor((dueAt - startMs) / CYCLE_MS));
    const cyclesHit = new Set(
      hits.map((h) => cycleIndex(h.ts, dueAt)).filter((c) => c >= 1 && c <= 4));
    const last = hits.length ? hits[hits.length - 1].ts : null;

    const cycles_due_4 = Math.min(observed_cycles, 4);
    const email = (s.email || "").toLowerCase();
    const rec = deliveryByEmail.get(email) || {};
    let cycles_delivered_4 = 0, cycles_no_product_4 = 0, cycles_missing_4 = 0;
    for (let c = 1; c <= cycles_due_4; c++) {
      const st = rec[c];
      if (st === "delivered") cycles_delivered_4++;
      else if (st === "skipped") cycles_no_product_4++;
      else cycles_missing_4++;              // "failed" or no entry at all
    }

    const pf = s.payment_failing ? Date.parse(s.payment_failing + "T00:00:00Z") : NaN;

    const facts = {
      active: s.active,
      payment_failing: !!s.payment_failing,
      payment_failing_days: Number.isFinite(pf) ? day(now - pf) : null,
      collided: collided.has(t8),
      observed_cycles,
      downloads: hits.length,
      days_since_download: last === null ? null : day(now - last),
      cycles_hit_4: cyclesHit.size,
      cycles_due_4, cycles_delivered_4, cycles_no_product_4, cycles_missing_4,
      have_send_log,
      machine_suspect: p.machine,
      inactive_clicks: p.inactive,
      no_file: p.no_file,
    };
    const c = classifyRow(facts);
    counts[c.state] = (counts[c.state] || 0) + 1;

    const row = {
      // IDENTITY: t8 plus `since`. STRIPE_AUDIT identifies rows by their
      // `since` date for exactly this reason — it is enough for the one person
      // who has the customer list open, and useless to anyone who does not.
      t8, since: s.since || null,
      active: s.active !== false,
      cancelled: s.cancelled || null,
      payment_failing: s.payment_failing || null,
      first_download: hits.length ? iso(hits[0].ts) : null,
      last_download: last === null ? null : iso(last),
      downloads: hits.length,
      downloads_28d: hits.filter((h) => now - h.ts < 28 * 86400_000).length,
      cycles_hit_4: cyclesHit.size,
      observed_cycles,
      cycles_due_4, cycles_delivered_4, cycles_no_product_4, cycles_missing_4,
      machine_suspect: p.machine,
      inactive_clicks: p.inactive,
      no_file: p.no_file,
      device: hits.length ? hits[hits.length - 1].dev : null,
      engagement: c.engagement,
      billing: c.billing,
      state: c.state,
      blame: c.blame,
      action: c.action,
      flags: c.flags,
    };
    rows.push(row);

    const was = prevByT8.get(t8);
    if (was && was.state && was.state !== row.state) {
      transitions.push({ t8, since: row.since, from: was.state, to: row.state });
    }
  }

  // ---- fleet level ----
  // Nobody fetched all week. This is corroboration of a delivery failure that
  // does NOT depend on feed-send-log.json having been written — which is
  // precisely the 2026-08-03 failure, where the absence of a log entry was the
  // only symptom and nothing was watching for an absence.
  const fleet_zero_last_cycle =
    rows.some((r) => r.active) &&
    rows.every((r) => !r.last_download || Date.parse(r.last_download) < dueAt - CYCLE_MS);

  const flagCount = (name) => rows.filter((r) => r.flags.includes(name)).length;
  const transitions_to = {};
  for (const t of transitions) transitions_to[t.to] = (transitions_to[t.to] || 0) + 1;

  // ---- the HTTP body ----
  // COUNTS ONLY. This lands verbatim in a public repo's Actions log.
  const response = {
    ok: true,
    subscribers: rows.length,
    active: rows.filter((r) => r.active).length,
    ...counts,
    engaged: rows.filter((r) => r.engagement === "engaged").length,
    casual: rows.filter((r) => r.engagement === "casual").length,
    downloads_28d: rows.reduce((n, r) => n + r.downloads_28d, 0),
    machine_suspect: machine_total,
    unmatched_403,
    unmatched_403_28d,
    inactive_403,
    no_file: no_file_total,
    malformed_events,
    delivery_gap: flagCount("delivery_gap"),
    never_sent: flagCount("never_sent"),
    dunning_stale: flagCount("dunning_stale"),
    winback_signal: flagCount("winback_signal"),
    served_no_file: flagCount("served_no_file"),
    fleet_zero_last_cycle,
    transitions: transitions.length,
    transitions_to,
    have_send_log,
    due_at: iso(dueAt),
    instrumented_at: instrumentedAt,
  };

  // Anything a human must look at. The digest is sent ONLY when this is true:
  // a watchdog that emails on success gets filtered, and send-watchdog.yml
  // already learned that lesson the expensive way.
  const alert =
    fleet_zero_last_cycle ||
    response.delivery_gap > 0 || response.never_sent > 0 ||
    response.dunning_stale > 0 || response.served_no_file > 0 ||
    response.winback_signal > 0 || response.unattributable > 0 ||
    transitions.some((t) => ["lapsed", "never-downloaded", "payment-failing",
                             "cancelled"].includes(t.to)) ||
    rows.some((r) => r.action === "ask_referral");

  return {
    at: iso(now),
    due_at: iso(dueAt),
    instrumented_at: instrumentedAt,
    rows, counts, transitions, response, alert,
  };
}

// ── owner digest ────────────────────────────────────────────────────────────
// THE ONLY ARTIFACT IN THIS SYSTEM THAT CARRIES A SUBSCRIBER EMAIL. It is
// composed here and handed straight to Resend by engagement.js, addressed to
// the owner. It is never written to R2, never returned in an HTTP body, and
// never routed through the OIDC-gated owner-mail relay — that endpoint takes
// its HTML body from its caller, and the caller would be a workflow whose logs
// are public. (Named only descriptively: ENGAGEMENT.md E6 greps for its route.)
export function buildDigest(result, subs) {
  const byT8 = new Map();
  for (const s of (subs || [])) if (s && s.token) byT8.set(t8of(s.token), s);
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const order = { "fix_delivery_first": 0, "check_dunning_endstate": 1, "contact_48h": 2,
                  "ask_how_they_use_it": 3, "winback": 4, "lengthen_join_key": 5,
                  "ask_referral": 6, "watch_stripe": 7, "none": 9 };
  const rows = result.rows.slice().sort(
    (a, b) => (order[a.action] ?? 9) - (order[b.action] ?? 9));

  const line = (r) => {
    const s = byT8.get(r.t8);
    const who = s ? `${esc(s.name || "(no name)")} &lt;${esc(s.email)}&gt;` : `(row ${esc(r.t8)})`;
    const bits = [
      `state <b>${esc(r.state)}</b>`,
      `since ${esc(r.since)}`,
      `${r.downloads} download(s)`,
      r.last_download ? `last ${esc(r.last_download.slice(0, 10))}` : "never downloaded",
      `${r.cycles_delivered_4}/${r.cycles_due_4} cycles actually delivered`,
    ];
    if (r.flags.length) bits.push(`flags: ${esc(r.flags.join(", "))}`);
    return `<li style="margin:0 0 10px"><b>${who}</b><br>
      <span style="color:#445;font-size:13px">${bits.join(" &middot; ")}</span><br>
      <span style="font-size:13px">Do: <b>${esc(r.action)}</b>${
        r.blame === "us" ? ' &mdash; <b style="color:#b45309">this one is ours, not theirs</b>' : ""
      }</span></li>`;
  };

  const acting = rows.filter((r) => r.action !== "none");
  const head = result.response.fleet_zero_last_cycle
    ? `<p style="background:#fff1f0;border:1px solid #f5a3a3;border-radius:8px;padding:12px">
       <b>NOBODY fetched anything last cycle.</b> Read this as a delivery failure first, not
       as disinterest. Check feed-send-log.json and Resend before drawing any conclusion
       about customers.</p>` : "";

  const html = `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:620px;color:#0e1622">
    <h2 style="color:#0e7c6b">Subscriber lifecycle &mdash; week of ${esc(result.due_at.slice(0, 10))}</h2>
    ${head}
    <p style="color:#445;font-size:14px">${result.rows.length} subscriber(s).
    ${STATES.filter((s) => result.counts[s]).map((s) => `${result.counts[s]} ${esc(s)}`).join(", ") || "none classified"}.</p>
    ${acting.length ? `<h3 style="font-size:15px">Needs a human</h3><ul style="padding-left:18px">${acting.map(line).join("")}</ul>`
                    : `<p>Nothing needs a human this week.</p>`}
    ${result.transitions.length ? `<h3 style="font-size:15px">Changed since last run</h3><ul style="padding-left:18px">${
      result.transitions.map((t) => `<li>${esc((byT8.get(t.t8) || {}).email || t.t8)}: ${esc(t.from)} &rarr; <b>${esc(t.to)}</b></li>`).join("")}</ul>` : ""}
    <p style="color:#667;font-size:12.5px;margin-top:22px">
    With ${result.rows.length} subscriber(s) this is a per-customer tripwire, not a statistic.
    Do not quote a percentage, a rate or a trend from it until there are 15 active subscribers.
    <br>A <b>never-downloaded</b> row means "never used the link" &mdash; the Monday email also
    carries the ZIP as an attachment, so an attachment-only user records zero downloads and
    looks dead. Ask before concluding.</p></div>`;

  const subject = "MassPermits lifecycle: " +
    (acting.length ? `${acting.length} subscriber(s) need a look` : "no action needed");
  return { subject, html, actionable: acting.length };
}

// ── R2 glue ─────────────────────────────────────────────────────────────────
// `bucket` is duck-typed (get / put / list / delete), so the dry run drives
// the REAL code path against an in-memory fake, including the cursor loop and
// the retention delete.
export const KEY_ENGAGEMENT = "engagement.json";
export const PREFIX_DL = "dl/";

// The one call the weekly send and the admin dashboard make. Both already bind
// BUNDLES, so this needs no new binding, no allowlist entry and no endpoint.
// A missing, empty or malformed object returns null and every caller must
// treat null as "behave exactly as before".
export async function readLifecycle(bucket) {
  try {
    const o = await bucket.get(KEY_ENGAGEMENT);
    if (!o) return null;
    const parsed = JSON.parse(await o.text());
    return (parsed && Array.isArray(parsed.rows)) ? parsed : null;
  } catch { return null; }
}

// Convenience for a consumer holding a token (weekly-send has one per
// subscriber): returns that subscriber's row, or null. Never throws.
export function rowForToken(lifecycle, token) {
  if (!lifecycle || !Array.isArray(lifecycle.rows)) return null;
  const t8 = t8of(token);
  if (!t8) return null;
  return lifecycle.rows.find((r) => r && r.t8 === t8) || null;
}

async function readJson(bucket, key) {
  try {
    const o = await bucket.get(key);
    return o ? JSON.parse(await o.text()) : null;
  } catch { return null; }
}

async function* listAll(bucket, prefix) {
  // R2 list() caps at 1000 keys and truncates SILENTLY without the cursor
  // loop. funnel.js:113-122 carries the same loop for the same reason.
  let cursor;
  do {
    const page = await bucket.list({ prefix, limit: 1000, cursor,
                                     include: ["customMetadata"] });
    for (const o of (page.objects || [])) yield o;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

export async function runRollup(bucket, opts = {}) {
  const now = opts.now || Date.now();
  const subs = (await readJson(bucket, "subscribers.json")) || [];
  const sendLog = (await readJson(bucket, "feed-send-log.json")) || [];
  const prev = await readLifecycle(bucket);

  // Monotonic forward only. First run with nothing stored stamps today, which
  // is the true date measurement began.
  const floor = INSTRUMENTED_AT_FLOOR;
  const stored = (prev && prev.instrumented_at) || iso(now).slice(0, 10);
  const instrumentedAt = stored > floor ? stored : floor;

  const events = [];
  const stale = [];
  const cutoff = now - RETAIN_DAYS * 86400_000;
  for await (const o of listAll(bucket, PREFIX_DL)) {
    events.push({ key: o.key, customMetadata: o.customMetadata || {} });
    // dl/<YYYY-MM-DD>/<epoch-ms>-<hex>
    const dpart = String(o.key || "").slice(PREFIX_DL.length, PREFIX_DL.length + 10);
    const dms = Date.parse(dpart + "T00:00:00Z");
    if (Number.isFinite(dms) && dms < cutoff) stale.push(o.key);
  }

  const result = rollup({ subs, events, sendLog, now, instrumentedAt, prev });

  // Persist. This is the object weekly-send and the admin dashboard read.
  let stored_ok = true;
  try {
    await bucket.put(KEY_ENGAGEMENT, JSON.stringify({
      at: result.at, due_at: result.due_at, instrumented_at: result.instrumented_at,
      counts: result.counts, rows: result.rows, transitions: result.transitions,
    }), { httpMetadata: { contentType: "application/json" } });
  } catch { stored_ok = false; }

  // Retention, bounded. A 400-day backlog must drain over several runs rather
  // than blow the subrequest budget in one.
  let pruned = 0;
  const doomed = stale.slice(0, PRUNE_MAX_PER_RUN);
  try {
    for (let i = 0; i < doomed.length; i += 100) {
      await bucket.delete(doomed.slice(i, i + 100));
      pruned += Math.min(100, doomed.length - i);
    }
  } catch { /* retention must never fail the rollup */ }

  result.response.stored = stored_ok;
  result.response.pruned = pruned;
  result.response.prune_remaining = Math.max(0, stale.length - pruned);
  result.digest = buildDigest(result, subs);
  return result;
}

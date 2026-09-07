// MassPermits — subscriber lifecycle, for the operator's screen (Access-gated).
//
// WHAT THIS IS
// ------------
// The read side of the lifecycle signal. /api/engagement (OIDC, workflow-only)
// COMPUTES the rollup once a week and writes engagement.json. This route only
// READS that object and hands it to /admin. Two callers, two gates, one file.
//
// THIS ROUTE NEVER RUNS THE ROLLUP. That is not a style preference:
//   * runRollup() writes engagement.json and DELETES dl/ events past retention.
//     A browser refresh must not be able to mutate the event log, and a page
//     left open on a phone must not be able to do it forty times.
//   * The rollup's numbers are only meaningful at a fixed point in the cycle —
//     90 minutes after the send, judged on completed cycles. Recomputing at
//     16:40 on a Thursday would produce a different, worse answer to the same
//     question, and the two surfaces would disagree.
// So the dashboard shows what the last rollup found, and says out loud how old
// that is. See `stale` below.
//
// WHY THE NAME BEGINS `pipeline-`
// -------------------------------
// Gating by inheritance, the same reason pipeline-now.js gives at its line 15.
// Two independent controls already cover the prefix /api/pipeline:
// functions/_middleware.js GUARDED (a PREFIX match, so this 404s on the
// permanent <hash>.pages.dev twin) and the Cloudflare Access application's
// path expression. Naming this file anything else would mean a hand-made
// Cloudflare dashboard change to gate it, remembered correctly, at deploy time.
// Neither of those two files is edited to add this route — and _middleware.js
// in particular runs in front of /api/stripe-webhook and /api/weekly-send, so
// not editing it is the point.
//
// PRIVACY
// -------
// engagement.json holds no email, no name and no full token by construction
// (_lifecycle.js: rows carry `t8`, the first 8 hex of the download token, plus
// `since`). This route adds nothing to it. A row is identified here the way
// STRIPE_AUDIT.md identifies one — by its `since` date — which is enough for
// the one person holding the customer list and useless to anyone else. The
// only artifact in this system that names a subscriber is the owner digest,
// composed inside /api/engagement and mailed to the owner's own inbox.
// scrub() at the bottom is the last line of defence and proves it rather than
// asserting it. Keep it if this file is ever refactored.
//
// SENDS NOTHING. WRITES NOTHING. Safe to call as often as you like.

import { verifyCfAccess, accessDenied } from "./_cf-access.js";
import { readLifecycle, STATES, LAPSE_DAYS, WARMUP_CYCLES, ENGAGED_OF_4,
         CYCLE_MS, lastDueAt } from "./_lifecycle.js";

// What to do first, worst first. Same ordering the owner digest uses, so the
// screen and the email cannot disagree about what matters.
const ACTION_ORDER = {
  fix_delivery_first: 0,      // WE failed them. Always first. 2026-08-03.
  check_dunning_endstate: 1,  // STRIPE_AUDIT §5: possibly shipping a $99 product unpaid
  contact_48h: 2,             // lapsed — the churn precursor
  ask_how_they_use_it: 3,     // never-downloaded
  winback: 4,                 // cancelled, still clicking
  lengthen_join_key: 5,       // t8 collision
  ask_referral: 6,            // the one good-news action
  watch_stripe: 7,
  none: 9,
};

const ACTION_SAYS = {
  fix_delivery_first:
    "This one is ours, not theirs. A cycle inside the window was not delivered. " +
    "Make good the missing file before writing to them about anything else.",
  check_dunning_endstate:
    "Card has been failing longer than Stripe's whole retry schedule and the row is " +
    "still active. Read Stripe > Settings > Billing > Manage failed payments. If " +
    "\"if all retries fail\" is not \"Cancel the subscription\", this customer is " +
    "receiving the paid feed unpaid, forever.",
  contact_48h:
    "Downloaded before, nothing for " + LAPSE_DAYS + "+ days. Check the delivery record " +
    "for those weeks FIRST. Then three lines, human sent: what happened, what changed, " +
    "here is your link. No discount. Nothing in the record says price caused a lapse.",
  ask_how_they_use_it:
    "No download on record. Confirm we actually sent it before concluding anything. " +
    "Then ask what they do with the file, and whether they use the attachment or the " +
    "button. The Monday email carries both, so an attachment-only user looks dead here.",
  winback:
    "Cancelled, and still clicking their old link. /api/my-leads 403s them, so this is " +
    "the only surface it shows up on.",
  lengthen_join_key:
    "Two subscribers share a token prefix, so neither can be attributed. Take the join " +
    "key to 12 hex and re-run. No customer contact.",
  ask_referral:
    "Four of four cycles. Ask for the referral and the testimonial. The one customer " +
    "who churned volunteered a testimonial four days before the miss and was never asked.",
  watch_stripe: "Card failing. Stripe is retrying. Nothing to do yet.",
  none: "",
};

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await verifyCfAccess(request, env);
  if (!auth.ok) {
    // A navigation gets the HTML page; the board's own fetch gets JSON.
    return (request.headers.get("accept") || "").includes("text/html")
      ? accessDenied(auth)
      : json({ error: "unauthorized", reason: auth.reason, detail: auth.detail || null }, 403);
  }

  const now = Date.now();
  const life = await readLifecycle(env.BUNDLES);

  // NOT AN ERROR. Before the first rollup runs, "we have never measured this"
  // is the true answer, and it is a different answer from "nobody downloaded
  // anything". Saying so is the whole point — the metric exists because the
  // business could not previously tell those two apart.
  if (!life) {
    return json(scrub({
      ok: true,
      now: new Date(now).toISOString(),
      signed_in_as: auth.email || null,
      measured: false,
      headline: "Download tracking has not produced a reading yet.",
      what_to_do:
        "engagement.json is not in R2. Either /api/engagement has never run, or its " +
        "step in send-watchdog.yml is not deployed. Until it runs, nothing on this " +
        "card is evidence about any customer.",
      counts: null, rows: [], needs_human: [], not_measured: notMeasured(),
    }), 200);
  }

  const rows = Array.isArray(life.rows) ? life.rows : [];
  const at = Date.parse(life.at);
  const ageH = Number.isFinite(at) ? (now - at) / 3600_000 : null;

  // STALENESS IS A FIRST-CLASS FIELD, not a footnote.
  // A stored JSON read as current is how the other business's FY27 watcher died
  // quietly: the file still parsed, so nothing looked wrong. If the rollup has
  // not run since the most recent send, every state below describes the week
  // BEFORE last, and "healthy" on this screen would be a claim nobody checked.
  const dueAt = lastDueAt(now);
  const stale = !Number.isFinite(at) || at < dueAt;
  // Two cycles without a rollup is not lag, it is a dead watcher.
  const dead = Number.isFinite(at) && at < dueAt - CYCLE_MS;

  const counts = Object.fromEntries(
    STATES.map((s) => [s, rows.filter((r) => r && r.state === s).length]));

  const decorated = rows.map((r) => ({
    // IDENTITY: t8 + since. No email, no name, no full token — none of those
    // are in engagement.json to begin with.
    t8: r.t8, since: r.since,
    state: r.state, engagement: r.engagement, billing: r.billing,
    blame: r.blame, action: r.action, flags: r.flags || [],
    says: ACTION_SAYS[r.action] || "",
    downloads: r.downloads, downloads_28d: r.downloads_28d,
    last_download: r.last_download, first_download: r.first_download,
    days_since_download: r.last_download
      ? Math.floor((now - Date.parse(r.last_download)) / 86400_000) : null,
    cycles_hit_4: r.cycles_hit_4,
    // The honest denominator. "0 of 4 cycles" reads as a dead customer until
    // you can see that only one of those four was ever actually delivered.
    delivered: r.cycles_delivered_4, due: r.cycles_due_4,
    observed_cycles: r.observed_cycles,
    machine_suspect: r.machine_suspect, inactive_clicks: r.inactive_clicks,
    no_file: r.no_file, device: r.device,
    active: r.active, cancelled: r.cancelled, payment_failing: r.payment_failing,
  }));

  const ordered = decorated.slice().sort(
    (a, b) => (ACTION_ORDER[a.action] ?? 9) - (ACTION_ORDER[b.action] ?? 9));
  const needs = ordered.filter((r) => r.action !== "none");
  const ours = needs.filter((r) => r.blame === "us");

  const headline = stale
    ? (dead ? "These states are more than a week out of date."
            : "The rollup has not run since this week's send.")
    : ours.length
      ? `${ours.length} subscriber(s) we failed, not the other way round.`
      : needs.length
        ? `${needs.length} subscriber(s) need a human.`
        : rows.length === 0
          ? "No subscribers on the list."
          : counts.warming === rows.length
            ? "Still warming up. No signal is trustworthy yet, by design."
            : "Nothing needs a human this week.";

  return json(scrub({
    ok: true,
    now: new Date(now).toISOString(),
    signed_in_as: auth.email || null,
    measured: true,
    // Provenance, so nobody has to guess how fresh this is.
    rollup_at: life.at || null,
    rollup_age_h: ageH === null ? null : Number(ageH.toFixed(1)),
    due_at: new Date(dueAt).toISOString(),
    instrumented_at: life.instrumented_at || null,
    stale, dead,
    headline,
    what_to_do: stale
      ? "Do not act on the states below until the rollup runs. Check the engagement " +
        "step in send-watchdog.yml, then call /api/engagement from the workflow."
      : (needs[0] ? needs[0].says : ""),
    subscribers: rows.length,
    active: rows.filter((r) => r.active).length,
    counts,
    needs_human: needs,
    rows: ordered,
    transitions: Array.isArray(life.transitions) ? life.transitions.map((t) => ({
      t8: t.t8, since: t.since, from: t.from, to: t.to })) : [],
    thresholds: { lapse_days: LAPSE_DAYS, warmup_cycles: WARMUP_CYCLES,
                  engaged_of_4: ENGAGED_OF_4 },
    not_measured: notMeasured(),
  }), 200);
}

// Stated on the card itself, not in a document nobody has open. A green board
// read as "all clear" is the exact error that made 2026-08-03 invisible.
function notMeasured() {
  return [
    { what: "Whether a subscriber who never clicks the link is actually using the product",
      why: "The Monday email carries the ZIP as an attachment AND the button. An " +
           "attachment-only user records zero downloads and looks dead. never-downloaded " +
           "means \"never used the link\", not \"never used the product\". Ask before concluding." },
    { what: "Whether a recorded download was a human",
      why: "Corporate mail security fetches links in incoming mail. The bot regex runs at " +
           "write time and a fetch within 120 seconds of the send is flagged and not " +
           "credited, but neither test is sufficient. This is a lower bound on use and an " +
           "upper bound on enthusiasm." },
    { what: "Whether a cancelled customer is still being billed",
      why: "Only Stripe can answer that. If \"if all retries fail\" is not \"Cancel the " +
           "subscription\", a customer who simply stops paying never produces " +
           "customer.subscription.deleted and keeps receiving the feed." },
    { what: "Whether the email arrived",
      why: "No Resend webhook exists. A hard bounce and a perfect delivery are recorded " +
           "identically." },
  ];
}

// LAST LINE OF DEFENCE. Same walker pipeline-now.js carries, deliberately
// duplicated rather than imported: it is a defence, and a defence that lives in
// someone else's route file can be refactored away by someone solving an
// unrelated problem. Nothing above puts an address or a token in the payload —
// this proves it, so a field added later cannot leak one by accident.
function scrub(o) {
  const seen = new WeakSet();
  const walk = (v) => {
    if (typeof v === "string") {
      return v.replace(/[^\s<>@"]+@[^\s<>@"]+\.[A-Za-z]{2,}/g, "[address withheld]")
              .replace(/\b[0-9a-f]{32}\b/g, "[token withheld]");
    }
    if (!v || typeof v !== "object" || seen.has(v)) return v;
    seen.add(v);
    if (Array.isArray(v)) return v.map(walk);
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      // signed_in_as is the OPERATOR's own verified Access claim, rendered in
      // the header so a missing gate is visible. It is not customer data.
      out[k] = k === "signed_in_as" ? x : walk(x);
    }
    return out;
  };
  return walk(o);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
    },
  });
}

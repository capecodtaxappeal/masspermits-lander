// MassPermits — "is anything wrong?" in one payload (Pages Function, Access-gated).
//
// THE QUESTION THIS ANSWERS
// -------------------------
// The operator is on a phone. He has 20 seconds and one URL. He wants a yes or
// a no, and if it is a no, the one sentence that says what to do. Everything
// else on this page is subordinate to that sentence.
//
// Today the honest answer to "is anything wrong?" requires four wrangler reads
// against a CLI that KB/01 §9a measured serving >20 minutes of stale bytes on a
// hot key, plus the GitHub Actions API, plus Stripe, plus a Gmail search. It is
// not answerable from a phone at all, which is why on 2026-08-03 the answer
// arrived from a paying customer instead.
//
// WHY THIS FILE IS NAMED `pipeline-now` AND NOT `health` OR `status`
// -----------------------------------------------------------------
// Gating, not aesthetics. Two independent controls already cover the prefix
// `/api/pipeline`:
//   * functions/_middleware.js:37 GUARDED = ["/admin", "/api/pipeline"], a
//     PREFIX match, so this route 404s on the permanent <hash>.pages.dev twin
//     without editing that file. Editing it would put a new code path in front
//     of /api/stripe-webhook and /api/weekly-send, which is a direct hit on the
//     invariant that says never touch the paying-customer path.
//   * the Cloudflare Access application, whose path expression covers
//     masspermits.com/api/pipeline* per admin/pipeline.html's header.
// Naming it anything else means a Cloudflare dashboard change to gate it, made
// by hand, remembered correctly, at the same time as the deploy. This name
// makes the gate inherited instead of configured. **VERIFY ONCE** that the
// Access path expression really is a wildcard and not the exact string
// `/api/pipeline` — the one-command check is in BUILD_presend.md §7.
//
// WHY IT IS NOT THE EXISTING /api/pipeline
// ----------------------------------------
// That file's header states, and a merge-time grep enforces, that it never
// names or reads the R2 customer list. This surface needs paying-subscriber
// COUNTS. Rather than weaken that invariant, this file gets the counts from
// funnel-metrics.json and feed-send-log.json — two objects that already hold
// them as numbers, written by code that did the reading. So this file does not
// read the customer list either, and neither invariant moves.
//
// PRIVACY, ENFORCED NOT ASKED FOR
// -------------------------------
// feed-send-log.json's `sent[]` entries and delivery-log.json's entries BOTH
// carry a customer email address in `to`. This file reads both objects and
// emits COUNTS ONLY. No `to`, no name, no token, no address reaches the
// payload on any path — including the error paths. `scrub()` at the bottom is
// the last line of defence and the thing to keep if this file is refactored.

import { verifyCfAccess, accessDenied } from "./_cf-access.js";
import { gather, evaluate, headline, bestSince, dueAt, holdDeadline } from "./_presend.js";

const HOUR = 3600_000;
const REFRESH_HOUR_UTC = 9;   // weekly-refresh.yml: "0 9 * * 1" + "0 9 * * 0,2-6"
const REFRESH_GRACE_H = 4;    // pipeline.js GRACE_H — same cadence, same number,
                              // and deliberately NOT weekly-send.js's 8 days.

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
  const rows = [];
  const notMeasured = [];

  let inp = null, gateErr = null;
  try {
    // hash=false: this page can be refreshed repeatedly and does not need the
    // ~1MB byte proof. /api/pre-send-check with the default does that once, at
    // the moment it matters, from the workflow.
    inp = await gather(env, { hash: false });
  } catch (e) {
    gateErr = String((e && e.message) || e).slice(0, 200);
  }

  const policy = (inp && inp.policy) || null;
  const gate = inp ? evaluate(now, inp) : null;
  const status = (inp && inp.status) || null;
  const log = (inp && inp.log) || [];
  const attempt = (inp && inp.attempt) || null;

  // ── ROW 1 — DATA. Did the daily scrape run? ──────────────────────────────
  // Due-based, never age-based: under an age rule a dropped 09:00 run is not
  // flagged until 21:00 the FOLLOWING day, so the board shows confident green
  // through the entire day of the outage.
  {
    const ranAt = status && status.ran_at ? Date.parse(status.ran_at) : NaN;
    const due = lastDue(now, REFRESH_HOUR_UTC);
    const overdue = now >= due + REFRESH_GRACE_H * HOUR;
    if (!Number.isFinite(ranAt)) {
      rows.push(row("data", "Data refresh", "bad",
        "no refresh has ever reported", "refresh-status.json is absent or unusable"));
    } else {
      const ageH = (now - ranAt) / HOUR;
      const landed = ranAt >= due;
      const cov = (status && status.coverage) || {};
      const errs = Object.keys((status && status.errors) || {}).length;
      const detail = `${cov.live_sources ?? "?"} of ${cov.expected_sources ?? "?"} town ` +
        `sources · ${num(status.count)} rows · ${errs} source error${errs === 1 ? "" : "s"}`;
      if (landed) {
        rows.push(row("data", "Data refresh", status.ok === false ? "warn" : "good",
          `ran ${ago(ageH)}`, detail));
      } else if (overdue) {
        rows.push(row("data", "Data refresh", "bad",
          `today's run has not landed — last ran ${ago(ageH)}`,
          "GitHub drops scheduled jobs under load. Force one: push any edit to " +
          ".github/workflows/weekly-refresh.yml on main."));
      } else {
        rows.push(row("data", "Data refresh", "warn",
          `today's run is late but inside its ${REFRESH_GRACE_H}h grace — last ran ${ago(ageH)}`,
          detail));
      }
    }
  }

  // ── ROW 2 — BUNDLE. Is the file customers get actually this morning's? ───
  {
    if (gateErr) {
      rows.push(row("bundle", "This week's bundle", "bad",
        "the pre-send check itself failed", gateErr));
    } else if (!gate) {
      rows.push(row("bundle", "This week's bundle", "unknown", "not checked", ""));
    } else {
      const st = gate.verdict === "GO" ? "good"
        : gate.verdict === "GO_WITH_DISCLOSURE" ? "good"
        : gate.verdict === "HOLD" ? "warn" : "bad";
      const ev = gate.evidence || {};
      rows.push(row("bundle", "This week's bundle", st, headline(gate),
        (ev.object_uploaded ? `uploaded ${ev.object_uploaded} (${ago(ev.object_age_h)})` : "not in R2") +
        (ev.rowset_verifiable === false ? " · row-level freshness unverifiable, no manifest yet" : "") +
        (ev.sha256_verified ? " · bytes verified against the manifest" : "")));
    }
  }

  // ── ROW 3 — SEND. Did Monday's delivery happen, to everyone? ─────────────
  {
    const p = policy || undefined;
    const due = dueAt(now, p);
    const best = bestSince(log, due);   // G1: the BEST outcome since due, not log[0]
    const graceOver = now >= due + 1.5 * HOUR;
    const triedSince = !!(attempt && Date.parse(attempt.at) >= due);
    if (!graceOver) {
      rows.push(row("send", "Monday delivery", "good", "nothing due yet this week",
        `next due ${new Date(due + 7 * 24 * HOUR).toISOString()}`));
    } else if (best && !best.skipped && (best.sent || []).some((s) => s && s.ok)) {
      const okN = (best.sent || []).filter((s) => s && s.ok).length;
      const badN = (best.sent || []).filter((s) => s && !s.ok).length;
      rows.push(row("send", "Monday delivery", badN ? "bad" : "good",
        badN ? `${badN} of ${okN + badN} deliveries FAILED`
             : `delivered to ${okN} subscriber${okN === 1 ? "" : "s"}`,
        `${best.at} · Resend returned 2xx. That is not proof of delivery — ` +
        "there is no bounce webhook and no open tracking."));
    } else if (best && best.skipped) {
      rows.push(row("send", "Monday delivery", "bad",
        "the send ran and mailed nobody",
        "The bundle was byte-identical to the one already delivered, so it was skipped. " +
        "The subscriber was told nothing at all. This is the failure they experience as " +
        "\"where is my email\"."));
    } else if (triedSince) {
      rows.push(row("send", "Monday delivery", "bad",
        "a send started and never recorded a result",
        "Some subscribers may already hold the file. Do NOT retry blind — read " +
        "feed-send-log.json first."));
    } else {
      rows.push(row("send", "Monday delivery", "bad",
        "no delivery and no attempt since this week's send time",
        `due ${new Date(due).toISOString()}`));
    }
  }

  // ── ROW 4 — MONEY. Counts only, straight out of funnel-metrics.json. ─────
  {
    const fm = await readJson(env, "funnel-metrics.json");
    const snap = Array.isArray(fm) && fm.length ? fm[0] : null;
    const dl = await readJson(env, "delivery-log.json");
    const lastPurchase = Array.isArray(dl) && dl.length && dl[0] && dl[0].at ? dl[0].at : null;
    if (!snap) {
      rows.push(row("money", "Subscribers & billing", "unknown",
        "no funnel snapshot", "funnel-metrics.json is absent"));
    } else {
      const bad = num(snap.payment_failing) > 0;
      const warn = num(snap.no_customer_id) > 0;
      rows.push(row("money", "Subscribers & billing", bad ? "bad" : warn ? "warn" : "good",
        `${num(snap.paying)} paying` +
        (bad ? ` · ${num(snap.payment_failing)} card failing` : "") +
        (warn ? ` · ${num(snap.no_customer_id)} with no Stripe id` : ""),
        (warn ? "A row with no Stripe customer id cannot be matched by a cancellation " +
                "event, so that subscription keeps delivering after it is cancelled. " : "") +
        (lastPurchase ? `last purchase delivery ${lastPurchase}` : "no purchase deliveries logged")));
    }
  }

  // ── What this page CANNOT see. Stated, so a green board is not read as
  //     "all clear" — which is the exact error that made 2026-08-03 invisible.
  notMeasured.push({
    what: "Whether any subscriber opened the product",
    why: "No open tracking, no download tracking. There is no evidence in company " +
         "history that any paying customer has ever opened it.",
  });
  notMeasured.push({
    what: "Whether the email was actually delivered",
    why: "weekly-send.js:200 throws on a non-2xx and returns a bare true. No Resend " +
         "webhook exists, so a hard bounce and a perfect delivery are recorded identically.",
  });
  notMeasured.push({
    what: "Whether a cancelled customer is still being billed a feed",
    why: "customer.subscription.deleted may never have been registered on the Stripe " +
         "endpoint. Only the Stripe dashboard can answer it.",
  });
  notMeasured.push({
    what: "Whether a customer is waiting on a reply",
    why: "That lives in Gmail. Median time-to-first-reply is 5.6 days and the worst " +
         "case, 33.5 days, is the whole of the only cancellation this business has had.",
  });

  const worst = rows.reduce((a, r) =>
    rank(r.state) > rank(a) ? r.state : a, "good");
  const bad = rows.filter((r) => r.state === "bad");
  const warn = rows.filter((r) => r.state === "warn");

  return json(scrub({
    ok: true,
    now: new Date(now).toISOString(),
    signed_in_as: auth.email || null,
    overall: worst === "good" ? "ALL_CLEAR" : worst === "warn" ? "WATCH" : "ACTION",
    // The sentence. Everything else on the page is subordinate to it.
    headline: bad.length ? bad[0].line
      : warn.length ? warn[0].line
      : "Nothing is wrong that this page can see.",
    what_to_do: bad.length ? bad[0].detail : warn.length ? warn[0].detail : "",
    rows,
    gate: gate ? {
      verdict: gate.verdict, code: gate.code, disclosure: gate.disclosure,
      customer_gets_nothing: gate.customer_gets_nothing,
      reasons: gate.reasons, notes: gate.notes,
      enforcing: !!(policy && policy.enforce),
      notice_enabled: !!(policy && policy.notice),
      hold_deadline: new Date(holdDeadline(now, policy || undefined)).toISOString(),
    } : null,
    not_measured: notMeasured,
  }), 200);
}

// ── helpers ────────────────────────────────────────────────────────────────
function row(id, label, state, line, detail) {
  return { id, label, state, line, detail: detail || "" };
}
const rank = (s) => ({ good: 0, unknown: 1, warn: 2, bad: 3 }[s] ?? 1);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function lastDue(now, hourUtc) {
  const d = new Date(now);
  d.setUTCHours(hourUtc, 0, 0, 0);
  if (d.getTime() > now) d.setUTCDate(d.getUTCDate() - 1);
  return d.getTime();
}

function ago(h) {
  if (h == null || !Number.isFinite(h)) return "unknown";
  if (h < 1) return `${Math.round(h * 60)} min ago`;
  if (h < 48) return `${h.toFixed(1)}h ago`;
  return `${Math.round(h / 24)} days ago`;
}

async function readJson(env, key) {
  try {
    const o = await env.BUNDLES.get(key);
    return o ? JSON.parse(await o.text()) : null;
  } catch { return null; }
}

// LAST LINE OF DEFENCE. Two of the objects this file reads carry customer email
// addresses. Nothing above puts one in the payload — this walks the finished
// object and proves it, so a future field cannot leak one by accident. Keep it.
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

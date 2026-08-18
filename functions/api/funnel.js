// MassPermits — funnel metrics (Pages Function, OIDC-gated).
//
// Exists because nobody could answer "is the free tier working?". The capture
// card went onto ~99% of pages, the double-opt-in digest shipped, the sample
// flow ran — and there was NO way to count any of it. subscribers.json is a
// readable file, but the newsletter list and the prospect list live as one R2
// object per person under a prefix, and `wrangler r2 object` has no list
// subcommand. So the two stages between "visitor" and "customer" were dark.
//
// You cannot fix a funnel you cannot see. This counts every stage from
// customMetadata only (no body reads, so it stays inside the subrequest budget
// no matter how long the lists get), and writes a dated snapshot to R2 so the
// trend is visible over time rather than just today's number.
//
// Emails nothing. Changes no subscriber state. Safe to call as often as you like.

import { verifyGitHubOIDC } from "./_github-oidc.js";

const HISTORY_KEY = "funnel-metrics.json";
const KEEP = 180;              // ~6 months of daily snapshots

export async function onRequest(context) {
  const { request, env } = context;
  const auth = await verifyGitHubOIDC(request);
  if (!auth.ok) return json({ error: "unauthorized", reason: auth.reason }, 401);

  const now = Date.now();
  const within = (iso, days) => iso && (now - Date.parse(iso)) < days * 86400_000;

  // ---- free newsletter list ----
  const news = { total: 0, confirmed: 0, pending: 0, unsubscribed: 0,
                 new_7d: 0, new_30d: 0, confirmed_7d: 0, by_town: {} };
  for await (const o of listAll(env, "newsletter/")) {
    const m = o.customMetadata || {};
    news.total++;
    const unsub = m.un === "1";
    const conf = m.c === "1";
    if (unsub) news.unsubscribed++;
    else if (conf) news.confirmed++;
    else news.pending++;
    if (within(m.ts, 7)) news.new_7d++;
    if (within(m.ts, 30)) news.new_30d++;
    if (conf && !unsub && within(m.ts, 7)) news.confirmed_7d++;
    if (m.town) news.by_town[m.town] = (news.by_town[m.town] || 0) + 1;
  }
  // Only the top towns — a full map would balloon the snapshot for no insight.
  news.by_town = Object.fromEntries(
    Object.entries(news.by_town).sort((a, b) => b[1] - a[1]).slice(0, 15));

  // ---- free-sample prospects (the warmest non-paying audience) ----
  const pros = { total: 0, stage1: 0, stage2: 0, done: 0, new_7d: 0, new_30d: 0, by_trade: {} };
  for await (const o of listAll(env, "prospects/")) {
    const m = o.customMetadata || {};
    pros.total++;
    if (m.stage === "1") pros.stage1++;
    else if (m.stage === "2") pros.stage2++;
    else pros.done++;
    if (within(m.ts, 7)) pros.new_7d++;
    if (within(m.ts, 30)) pros.new_30d++;
    if (m.trade) pros.by_trade[m.trade] = (pros.by_trade[m.trade] || 0) + 1;
  }
  pros.by_trade = Object.fromEntries(
    Object.entries(pros.by_trade).sort((a, b) => b[1] - a[1]).slice(0, 10));

  // ---- paying ----
  let paying = 0, paying_total = 0;
  try {
    const so = await env.BUNDLES.get("subscribers.json");
    const subs = so ? JSON.parse(await so.text()) : [];
    paying_total = (subs || []).length;
    paying = (subs || []).filter((s) => s && s.email && s.active !== false).length;
  } catch { /* leave at 0 rather than guess */ }

  // ---- the two numbers that actually matter ----
  // Conversion is reported as a ratio ONLY when the denominator is big enough to
  // mean something; below that it is noise dressed as a percentage.
  const rate = (n, d) => (d >= 20 ? +(100 * n / d).toFixed(1) : null);
  const snapshot = {
    at: new Date(now).toISOString(),
    newsletter: news,
    prospects: pros,
    paying, paying_total,
    conversion: {
      // free list -> paid, and warm prospects -> paid
      newsletter_to_paid_pct: rate(paying, news.confirmed),
      prospect_to_paid_pct: rate(paying, pros.total),
      note: "null means the denominator is under 20 — too small to quote",
    },
  };

  // Append to the rolling history so trend, not just level, is visible.
  try {
    const ho = await env.BUNDLES.get(HISTORY_KEY);
    const hist = ho ? JSON.parse(await ho.text()) : [];
    const today = snapshot.at.slice(0, 10);
    const kept = (Array.isArray(hist) ? hist : []).filter((h) => (h.at || "").slice(0, 10) !== today);
    kept.unshift(snapshot);
    await env.BUNDLES.put(HISTORY_KEY, JSON.stringify(kept.slice(0, KEEP)));
  } catch { /* never fail the read because the write failed */ }

  return json(snapshot);
}

// R2 list caps at 1000 keys per call; without the cursor loop this silently
// under-counts the moment either list crosses that line.
async function* listAll(env, prefix) {
  let cursor;
  do {
    const page = await env.BUNDLES.list({ prefix, limit: 1000, cursor,
                                          include: ["customMetadata"] });
    for (const o of page.objects) yield o;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

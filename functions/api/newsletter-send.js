// MassPermits — weekly "This Week in MA Permits" digest sender (Pages Function).
//
// OIDC-gated like /api/weekly-send (GitHub Actions cron hits it Mondays 14:00 UTC,
// after the 09:00 data refresh). Reads confirmed double-opt-in readers from
// newsletter/<email> customMetadata (c="1", no un flag — zero body reads), builds
// the digest from the site's own public /feed/permits.json, sends via Resend with
// a per-recipient one-click unsubscribe link.
//
// Freshness gate: aborts if refresh-status.json says the data pipeline failed or
// is >8 days stale — a digest of old data is worse than no digest.

import { verifyGitHubOIDC } from "./_github-oidc.js";

const MAX_PER_RUN = 300;

export async function onRequest(context) {
  const { request, env } = context;
  const auth = await verifyGitHubOIDC(request);
  if (!auth.ok) return json({ error: "unauthorized", reason: auth.reason }, 401);

  try {
    // freshness gate (same contract as weekly-send)
    const st = await env.BUNDLES.get("refresh-status.json");
    if (st) {
      const status = JSON.parse(await st.text());
      if (status.ok === false) return json({ ok: false, error: "last refresh FAILED — digest aborted" }, 500);
      const age = Date.now() - Date.parse(status.ran_at || 0);
      if (!(age < 8 * 86400_000)) return json({ ok: false, error: "data stale — digest aborted" }, 500);
    }

    // confirmed readers (metadata only)
    const readers = [];
    let cursor;
    do {
      const list = await env.BUNDLES.list({ prefix: "newsletter/", limit: 1000, cursor, include: ["customMetadata"] });
      for (const o of list.objects) {
        const m = o.customMetadata || {};
        if (m.c === "1" && m.un !== "1" && m.tok) {
          readers.push({ email: decodeURIComponent(o.key.slice("newsletter/".length)), tok: m.tok });
        }
      }
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);
    if (!readers.length) return json({ ok: true, note: "no confirmed readers yet" });

    // digest content from our own public feed
    const feedResp = await fetch("https://masspermits.com/feed/permits.json");
    if (!feedResp.ok) return json({ ok: false, error: "feed fetch " + feedResp.status }, 500);
    const items = (await feedResp.json()).items || [];
    const digest = buildDigest(items);

    const sent = [];
    for (const r of readers.slice(0, MAX_PER_RUN)) {
      try {
        await sendDigest(env, r, digest);
        sent.push({ to: r.email, ok: true });
      } catch (e) {
        sent.push({ to: r.email, ok: false, error: String(e && e.message || e).slice(0, 120) });
      }
    }
    return json({ ok: true, readers: readers.length, sent: sent.length,
      failed: sent.filter(s => !s.ok).length });
  } catch (e) {
    return json({ ok: false, error: String(e && e.message || e) }, 500);
  }
}

function buildDigest(items) {
  const towns = {}, trades = {};
  for (const it of items) {
    if (it._town) towns[it._town] = (towns[it._town] || 0) + 1;
    if (it._trade) trades[it._trade] = (trades[it._trade] || 0) + 1;
  }
  const topTowns = Object.entries(towns).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const topTrades = Object.entries(trades).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const biggest = items.filter(i => typeof i._value === "number" && i._value > 0)
    .sort((a, b) => b._value - a._value).slice(0, 3);
  return { total: items.length, topTowns, topTrades, biggest };
}

const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const money = v => { try { return "$" + Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 }); } catch { return "—"; } };
const slug = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
function b64url(s) { return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }

async function sendDigest(env, reader, d) {
  const date = new Date().toISOString().slice(0, 10);
  const unsub = `https://masspermits.com/api/newsletter?u=${b64url(reader.email)}.${reader.tok}`;
  const townRows = d.topTowns.map(([t, n]) =>
    `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee"><a href="https://masspermits.com/permits/${slug(t)}" style="color:#0e7c6b;text-decoration:none;font-weight:600">${esc(t)}</a></td>
     <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;font-weight:700">${n}</td></tr>`).join("");
  const bigRows = d.biggest.map(b =>
    `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee">${esc((b.title || "").replace(/ — .*$/, ""))} — ${esc(b._town)}</td>
     <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;color:#0a7d47;font-weight:700">${money(b._value)}</td></tr>`).join("");
  const tradeChips = d.topTrades.map(([t, n]) =>
    `<span style="display:inline-block;background:#eef7f4;border:1px solid #cfe9e2;border-radius:14px;padding:3px 10px;margin:2px;font-size:12px;color:#0e7c6b">${esc(t)} · ${n}</span>`).join(" ");

  const html = `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:580px;margin:0 auto;color:#0e1622">
    <p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#0e7c6b;font-weight:700;margin:0 0 4px">This Week in MA Permits · ${date}</p>
    <h2 style="margin:0 0 12px">${d.total} fresh building permits across Massachusetts</h2>
    <p style="color:#445;margin:0 0 18px">Where the work is being approved this week — every permit below is a
    homeowner cleared to spend. Full leads (exact address + owner) at <a href="https://masspermits.com" style="color:#0e7c6b">masspermits.com</a>.</p>
    <h3 style="margin:18px 0 6px;font-size:15px">Busiest towns</h3>
    <table style="width:100%;border-collapse:collapse;font-size:14px">${townRows}</table>
    <h3 style="margin:18px 0 6px;font-size:15px">Trades filing this week</h3>
    <p style="margin:0 0 6px">${tradeChips}</p>
    ${bigRows ? `<h3 style="margin:18px 0 6px;font-size:15px">Biggest projects</h3>
    <table style="width:100%;border-collapse:collapse;font-size:14px">${bigRows}</table>` : ""}
    <div style="background:#e9fbf6;border:1px solid #14b8a6;border-radius:10px;padding:16px;margin:20px 0;text-align:center">
      <p style="margin:0 0 10px;font-weight:600">Work these leads while they're fresh — full address &amp; owner, every Monday.</p>
      <a href="https://buy.stripe.com/dRmdR80Ms8WzctM9ZJ4gg01" style="background:#14b8a6;color:#04201c;font-weight:700;padding:11px 22px;border-radius:8px;text-decoration:none;display:inline-block">Start the Weekly Feed — $99/mo →</a>
      <p style="margin:10px 0 0;font-size:12px;color:#667">or grab a <a href="https://masspermits.com" style="color:#0e7c6b">free sample</a> first</p>
    </div>
    <p style="color:#9aa;font-size:12px;margin-top:22px">— MassPermits · masspermits.com · compiled from public municipal permit records<br>
    <a href="${unsub}" style="color:#9aa">Unsubscribe</a> — one click, no questions.</p></div>`;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.FROM_EMAIL, to: [reader.email],
      subject: `This Week in MA Permits — ${d.total} new filings, top town ${d.topTowns[0] ? d.topTowns[0][0] : "Boston"}`,
      html,
      headers: { "List-Unsubscribe": `<${unsub}>` } }),
  });
  if (!resp.ok) throw new Error("resend " + resp.status);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

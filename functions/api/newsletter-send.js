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
          readers.push({ email: decodeURIComponent(o.key.slice("newsletter/".length)),
                         tok: m.tok, town: m.town || "" });
        }
      }
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);
    if (!readers.length) return json({ ok: true, note: "no confirmed readers yet" });

    // digest content from our own public feed
    const feedResp = await fetch("https://masspermits.com/feed/permits.json");
    if (!feedResp.ok) return json({ ok: false, error: "feed fetch " + feedResp.status }, 500);
    const feedJson = await feedResp.json();
    const items = feedJson.items || [];
    const digest = buildDigest(items, feedJson);

    // Free TOWN tier: readers who signed up from a /permits/<town> page get a
    // digest scoped to their own town. Built once per distinct town (not per
    // reader) so a big list can't blow the subrequest budget.
    //
    // This USED to filter the statewide feed — which caps at 3 items per town.
    // A Falmouth reader would have been told "3 new building permits in
    // Falmouth" when the real number was an order of magnitude higher. That is
    // a fabricated statistic in outbound email, so we now read the town's OWN
    // feed (/feed/<town>.json), which is that town's real recent window.
    // Falls back to the statewide roundup rather than sending a wrong number.
    const MAX_TOWN_FETCHES = 20;   // subrequest budget guard
    const townDigests = new Map();
    let fetched = 0;
    for (const r of readers) {
      if (!r.town || townDigests.has(r.town)) continue;
      if (fetched >= MAX_TOWN_FETCHES) { townDigests.set(r.town, null); continue; }
      fetched++;
      let mine = null, meta = null;
      try {
        const tr = await fetch(`https://masspermits.com/feed/${r.town}.json`);
        if (tr.ok) { meta = await tr.json(); mine = meta.items || []; }
      } catch { mine = null; meta = null; }
      townDigests.set(r.town, mine && mine.length
        ? { ...buildDigest(mine, meta), town: r.town } : null);
    }

    const sent = [];
    for (const r of readers.slice(0, MAX_PER_RUN)) {
      try {
        await sendDigest(env, r, (r.town && townDigests.get(r.town)) || digest);
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

function buildDigest(items, meta) {
  const towns = {}, trades = {};
  for (const it of items) {
    if (it._town) towns[it._town] = (towns[it._town] || 0) + 1;
    if (it._trade) trades[it._trade] = (trades[it._trade] || 0) + 1;
  }
  const counts = Object.entries(towns).sort((a, b) => b[1] - a[1]);
  const topTowns = counts.slice(0, 6);
  const topTrades = Object.entries(trades).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const biggest = items.filter(i => typeof i._value === "number" && i._value > 0)
    .sort((a, b) => b._value - a._value).slice(0, 3);
  const dates = items.map(i => String(i.date_published || "").slice(0, 10)).filter(Boolean).sort();
  // items is TRUNCATED (60 per town / 100 statewide, and the statewide feed
  // additionally caps 3 per town). So items.length is a cap, not a count, and
  // its min/max dates narrow as a town gets busier. The feed now publishes the
  // uncapped window; prefer it, and fall back only when it is absent.
  const known = meta && Number.isInteger(meta._window_total);
  const total = known ? meta._window_total : items.length;
  // If the feed does not publish a window total we CANNOT state a count —
  // items.length would be the cap. Say "the latest" rather than a number.
  const unknownTotal = !known;
  // The statewide feed allows only 3 rows per town, so "busiest towns" there
  // ranks the cap, not activity: most towns tie at 3 and the genuinely busiest
  // town does not stand out. Claim a ranking only when the top is strictly
  // ahead of SECOND place — otherwise "top town X" is a coin flip.
  const ranked = counts.length > 1 && counts[0][1] > counts[1][1];
  return { total, unknownTotal, ranked, topTowns, topTrades, biggest,
           newest: (meta && meta._window_to) || dates[dates.length - 1] || "",
           oldest: (meta && meta._window_from) || dates[0] || "" };
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

  // A town reader gets their own town named in the header; the statewide reader
  // gets the roundup. Same data, scoped — that's the whole free-tier promise.
  const townName = d.town ? (d.topTowns[0] ? d.topTowns[0][0] : d.town) : "";
  // Say "recent", not "this week", and never "every permit filed" — the feed is
  // a rolling window, not a weekly census. d.total is the UNCAPPED window count
  // (items itself is truncated); if that is unavailable we say "the latest"
  // rather than print a cap as if it were a count.
  const kicker = townName ? `${esc(townName)} Permits · ${date}` : `MA Permit Activity · ${date}`;
  const n = d.unknownTotal ? "" : `${d.total} `;
  const headline = townName
    ? `${n}recent building permits in ${esc(townName)}`.replace(/^recent/, "Recent")
    : `${n}recent building permits across Massachusetts`.replace(/^recent/, "Recent");
  const window = d.oldest && d.newest ? ` Filed between ${d.oldest} and ${d.newest}.` : "";
  // "homeowner" was wrong on the statewide branch: it sits directly above a
  // Biggest-projects table sorted by valuation, which structurally selects the
  // LEAST residential rows in the set. "Property owner" is true of both.
  const intro = townName
    ? `The latest permit activity in ${esc(townName)} — each one a property owner cleared to spend.${window}
       Full detail (exact address + owner) at <a href="https://masspermits.com/permits/${slug(townName)}" style="color:#0e7c6b">masspermits.com</a>.`
    : `Where the work is being approved — every permit below is a
       property owner cleared to spend.${window} Full leads (exact address + owner) at <a href="https://masspermits.com" style="color:#0e7c6b">masspermits.com</a>.`;

  const html = `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:580px;margin:0 auto;color:#0e1622">
    <p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#0e7c6b;font-weight:700;margin:0 0 4px">${kicker}</p>
    <h2 style="margin:0 0 12px">${headline}</h2>
    <p style="color:#445;margin:0 0 18px">${intro}</p>
    ${townName || !d.ranked ? (townName ? "" : `<h3 style="margin:18px 0 6px;font-size:15px">Towns filing</h3>
    <p style="margin:0 0 6px;font-size:14px">${d.topTowns.map(([t]) => `<a href="https://masspermits.com/permits/${slug(t)}" style="color:#0e7c6b;text-decoration:none">${esc(t)}</a>`).join(" · ")}</p>`)
      : `<h3 style="margin:18px 0 6px;font-size:15px">Busiest towns</h3>
    <table style="width:100%;border-collapse:collapse;font-size:14px">${townRows}</table>`}
    <h3 style="margin:18px 0 6px;font-size:15px">Trades filing</h3>
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
      // No "top town X" unless the counts actually rank — on the statewide feed
      // most towns tie at the 3-per-town cap, so naming a winner is a coin flip
      // dressed as a fact (and the genuinely busiest town goes unnamed).
      subject: townName
        ? `${townName} permits — ${d.unknownTotal ? "latest filings" : d.total + " recent filings"}`
        : `MA permit activity — ${d.unknownTotal ? "the latest filings" : d.total + " recent filings"}${d.ranked && d.topTowns[0] ? ", top town " + d.topTowns[0][0] : ""}`,
      html,
      headers: { "List-Unsubscribe": `<${unsub}>` } }),
  });
  if (!resp.ok) throw new Error("resend " + resp.status);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

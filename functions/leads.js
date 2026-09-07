// MassPermits — the hosted leads portal (Pages Function).  KB/07 Stage D, D2.
//
// WHY THIS EXISTS
// The weekly leads ship as a ZIP attachment. QXO's M365 quarantines it and
// merkemh bought on a phone and cannot open a ZIP. This serves the SAME
// dashboard that is already inside the ZIP — one R2 object, streamed — behind
// the token that already exists.
//
// THE LOAD-BEARING CONSTRAINT (KB/07 §1.2)
// Email has a delivery EVENT; its absence is the alarm that made Silvestre
// write in on 2026-08-03. A URL has no such event. If this page can show last
// week's rows under a header that says "updated", the portal is a DOWNGRADE on
// email: the same failure, quieter. So freshness is not a garnish here:
//   * it is computed at REQUEST time, in this Function, from R2 head().uploaded
//     and refresh-status.ran_at — NEVER from the "updated <date>" string baked
//     into the HTML, which is `date.today()` on the build machine
//     (build_bundle.py:185) and has no causal relationship to the data;
//   * the RED state does not warn above the rows, it REPLACES the page, because
//     a warning over a full week of plausible-looking data still looks usable;
//   * the 8-day threshold is literally weekly-send.js's own constant. One number.
//
// AUTH — no passwords, no accounts, no new credential (KB/07 §2.2)
//   /leads?t=<32hex>  ->  validate against subscribers.json  ->  302 /leads
//                         + Set-Cookie mp_sess (HttpOnly, 14d, Path=/leads)
//   /leads            ->  cookie re-validated against subscribers.json on EVERY
//                         request (no isolate cache, so active:false revokes
//                         instantly), then the dashboard is streamed.
// The token is mint-only: it appears in emails and in one 302, never in a URL
// the customer keeps. The cookie is deliberately NOT signed — the token is
// already opaque and re-checked every request, so an HMAC secret would be one
// more thing to lose. HttpOnly is the part that matters: it stops the
// dashboard's own inline JS from reading the credential.
//
// WHAT IT EXPOSES, AND WHY THAT IS SAFE
// This is the PAID product behind a per-subscriber credential, not a public
// surface. It streams the identical bytes the same subscriber already receives
// as an email attachment: unmasked addresses and the "Permit holder" /
// by-contractor columns. Nothing here widens what that customer can already
// see. Every UNAUTHENTICATED response in this file — 400, 403, the inactive
// page, the kill-switch page, the 503 — is COUNTS ONLY: no rows, no addresses,
// no contractor or owner names, no email addresses, no tokens.
//
// WHAT IT WRITES: exactly one thing, an access-log line (§3.7). Never a full
// token, never an email, never a path string. The portal page carries NO
// site-wide page-view beacon (A4): traffic.js and live.js are unauthenticated
// and world-readable, and both echo the beacon's `p` param verbatim into public
// JSON. Instrument portal access with `location.pathname + location.search` and
// every live subscriber token becomes world-readable at /api/traffic. The log
// below is built in R2 instead, deliberately.

const COOKIE = "mp_sess";
const COOKIE_MAX_AGE = 1209600; // 14 days — a shared shop iPad is a real device
const TOKEN_RE = /^[0-9a-f]{32}$/; // 32-char hex UUID, dashes stripped
const HTML_KEY = "latest-weekly.html";
const ZIP_KEY = "latest-weekly.zip";
// SAME NUMBER as weekly-send.js:43 (`const fresh = age < 8 * 86400_000`).
// Two independent staleness thresholds is a bug generator; do not invent a second.
const STALE_MS = 8 * 86400_000;
const DRIFT_MS = 15 * 60_000; // html/zip upload gap that means the pair drifted
const RESUB = "https://masspermits.com/#get";

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const qHas = url.searchParams.has("t");
  const qToken = url.searchParams.get("t") || "";
  const cToken = cookieToken(request);

  // ---- 1. KILL SWITCH, read FIRST on every request (§6.2) --------------
  // This is the PRIMARY rollback lever, and it is primary for a structural
  // reason: a Cloudflare Pages rollback cannot be, because the same deployment
  // carries weekly-send.js — rolling back the portal rolls back the sender.
  // One `wrangler r2 object put portal.json`, no deploy, no git.
  const kill = await readKillSwitch(env);
  if (kill && kill.off === true) {
    const t = TOKEN_RE.test(qToken) ? qToken : (TOKEN_RE.test(cToken) ? cToken : "");
    if (t) return redirect("/api/my-leads?t=" + t); // straight to the ZIP
    return page(503, "The leads portal is paused",
      "<p>" + esc(kill.message || "We have paused this page for maintenance.") + "</p>" +
      "<p>Your leads are unaffected — use the <b>Download your leads</b> button in your " +
      "latest MassPermits email, which always serves the current file.</p>");
  }

  // ---- 2. TOKEN EXCHANGE: /leads?t=<32hex> -> 302 + cookie (§2.2) ------
  if (qHas) {
    if (!TOKEN_RE.test(qToken)) {
      return page(400, "That link is not valid",
        "<p>Missing or malformed download token. Open the button in your latest " +
        "MassPermits email rather than retyping the address.</p>");
    }
    const look = await lookup(env, qToken);
    if (look.error) return unavailable();
    if (!look.sub) return inactivePage(env, false);
    // A5: the token never survives in the address bar. 302 within ONE response,
    // and the body is null so the token cannot leak through the page either.
    return new Response(null, {
      status: 302,
      headers: sec({
        Location: "/leads",
        "Set-Cookie": COOKIE + "=" + qToken +
          "; HttpOnly; Secure; SameSite=Lax; Path=/leads; Max-Age=" + COOKIE_MAX_AGE,
      }),
    });
  }

  // ---- 3. BARE /leads: the cookie, re-validated every request ----------
  if (!TOKEN_RE.test(cToken)) {
    return page(403, "Open this from your Monday email",
      "<p>This page opens from the <b>View this week's leads</b> button in your " +
      "MassPermits email. That link signs you in for 14 days on this device.</p>" +
      "<p>Can't find the email? Reply to any message from us and we will send a " +
      "fresh link the same day.</p>",
      cToken ? { "Set-Cookie": clearCookie() } : null);
  }
  const look = await lookup(env, cToken);
  if (look.error) return unavailable();
  if (!look.sub) return inactivePage(env, true);

  return renderPortal(context, cToken, look.sub);
}

// HEAD, explicitly. Pages routes by method name: with only onRequestGet
// exported, a HEAD request gets a 405 from the framework and NONE of the four
// A1 headers — and A1's own test is `curl -sI`, which sends HEAD. So the
// assertion would fail on a portal that is otherwise correct, and worse, the
// operator's cheapest liveness probe would report 405 on a healthy page.
// Same logic, same status, same headers, body dropped. logAccess() ignores
// non-GET (see below) so a probe never counts as a customer opening their data.
export async function onRequestHead(context) {
  const r = await onRequestGet(context);
  try { if (r.body) r.body.cancel(); } catch (_) { /* nothing to release */ }
  return new Response(null, { status: r.status, headers: r.headers });
}

// ---------------------------------------------------------------------------
// THE PAGE
// ---------------------------------------------------------------------------

async function renderPortal(context, token, sub) {
  const { env } = context;

  // head(), not get(): `uploaded` is the only timestamp in this system that
  // goes stale when the pipeline stops (§6.1). ran_at, fetched_at and the
  // header's "updated <date>" are all RUN stamps — a successful build over
  // stale scraped data stamps today's date on rows nobody refreshed.
  const [hHtml, hZip, status] = await Promise.all([
    headSafe(env, HTML_KEY),
    headSafe(env, ZIP_KEY),
    readJson(env, "refresh-status.json"),
  ]);

  // The artifact is not in R2 (Stage B/C not shipped yet, or the workflow's
  // "Ship bundles to R2" step was skipped by an aborted refresh). Degrade to
  // the emailed download instead of 404-ing a paying customer. This is the
  // step-8 fallback that turns a deploy-ordering mistake into a degraded link
  // rather than an outage — it ships in v1, not later.
  if (!hHtml) return redirect("/api/my-leads?t=" + token);

  const now = Date.now();
  const tRan = status && status.ran_at ? Date.parse(status.ran_at) : NaN;
  const tHtml = hHtml.uploaded ? new Date(hHtml.uploaded).getTime() : NaN;
  const tZip = hZip && hZip.uploaded ? new Date(hZip.uploaded).getTime() : NaN;
  const ageRan = Number.isFinite(tRan) ? now - tRan : null;
  const ageHtml = Number.isFinite(tHtml) ? now - tHtml : null;
  const known = [ageRan, ageHtml].filter((a) => a !== null);

  // ---- RED (§2.5 rules 1-2). The rows are SUPPRESSED, not warned over. ----
  // Implemented by not streaming latest-weekly.html at all: the dashboard
  // rebuilds its table client-side from an embedded payload, so removing the
  // <table> would leave the data in the document and one script away from view.
  // A separate page is the only way "suppress" is actually true.
  let red = null;
  if (!known.length) {
    // Neither timestamp is readable. "Never ran" and "ran fine" must not look
    // alike (a green run is not proof), and the honest answer here is that we
    // do not know — which is a red, not a quiet grey line.
    red = { days: null };
  } else if (Math.max.apply(null, known) > STALE_MS) {
    red = { days: Math.floor(Math.max.apply(null, known) / 86400_000) };
  }
  if (red) {
    logAccess(context, token, "red");
    return page(200, "This week's data has not refreshed",
      "<p>" + (red.days === null
        ? "We cannot confirm how old this data is — the refresh record is missing."
        : "This data is <b>" + red.days + " days old</b> and we have not been able to refresh it.") +
      " <b>Do not work from this page.</b> Reply to your last email and we will sort it out.</p>" +
      "<p class=\"mp-dim\">Your rows are hidden deliberately. Stale permit records look " +
      "exactly like fresh ones, and a week-old list sends you to jobs that are already let.</p>",
      null, "bad");
  }

  // ---- AMBER (§2.5 rules 3-4). More than one can be true at once. ----
  const notes = [];
  if (ageRan === null || ageHtml === null) {
    notes.push("<p><b>We cannot fully confirm this page's freshness.</b> " +
      (ageRan === null
        ? "The refresh record (refresh-status.json) is missing or unreadable, so the age below comes from when this page was published, not from when the scrape ran."
        : "This page's publish timestamp is unavailable, so the age below comes from the refresh record.") +
      "</p>");
  }
  if (Number.isFinite(tHtml) && Number.isFinite(tZip) && Math.abs(tHtml - tZip) > DRIFT_MS) {
    notes.push("<p><b>This page and your download may disagree.</b> They were published " +
      minutesApart(tHtml, tZip) + " apart, so they did not come from the same run. " +
      "<b>The download is authoritative</b> — use the button in your email.</p>");
  }
  const cov = status && status.coverage ? status.coverage : null;
  if ((cov && cov.disclose) || (status && status.degraded)) {
    // MIRRORED from weekly-send.js sendEmail()'s amber box. That box is the
    // ONLY place in the system where the shortfall is disclosed —
    // _build_html() takes no coverage argument — so a portal without it does
    // not just lose a feature, it deletes the disclosure. Honesty regression,
    // not a UX one. The refund offer is carried across verbatim in substance.
    notes.push(
      "<p><b>Reduced coverage — please read.</b> This file covers <b>" +
      esc(num(cov && cov.live_sources, "fewer")) + " of " +
      esc(num(cov && cov.expected_sources, "our usual")) +
      "</b> town sources. On 1 August our largest upstream provider closed public " +
      "access to its permit records. We are rebuilding town by town from municipal sources.</p>" +
      (cov && Array.isArray(cov.monthly_sources) && cov.monthly_sources.length
        ? "<p>Note: " + esc(cov.monthly_sources.map((m) => String(m).replace(", MA", "")).join(", ")) +
          " publish their permits <b>monthly</b>, so their new rows arrive in a batch early " +
          "each month rather than weekly. Every row shows its issue date.</p>"
        : "") +
      "<p>Everything on this page is real and current. If a reduced feed is not worth your " +
      "subscription in the meantime, reply to your last email and we will refund you — no argument.</p>");
  }

  // ---- GREY (§2.5, otherwise) ----
  const refreshed = Number.isFinite(tRan) ? iso(tRan) : (Number.isFinite(tHtml) ? iso(tHtml) : "");
  const grey = "<p>Data refreshed " + esc(refreshed) + ". Next refresh Monday." +
    (Number.isFinite(tHtml) ? " <span class=\"mp-dim\">This page published " + esc(iso(tHtml)) + ".</span>" : "") +
    "</p>";

  const banner =
    "<div class=\"mp-note " + (notes.length ? "mp-amber" : "mp-grey") + "\">" +
    (notes.length ? notes.join("") : grey) + "</div>";

  // Watermark (§2.5.2). Local part only: enough for us to attribute a forwarded
  // screenshot to one subscriber, not enough to dox them into a WhatsApp group.
  // There is no technical fix for a link forwarding in one tap short of
  // accounts, which are ruled out; this makes casual sharing awkward and a real
  // leak attributable.
  const mark = esc((String(sub.email || "").split("@")[0] || "your subscription").slice(0, 40));
  const bar =
    "<div id=\"mp-portal\"><div class=\"mp-bar\">" +
    "<span>Licensed to <b>" + mark + "@&hellip;</b> &middot; do not forward</span>" +
    "<a class=\"mp-out\" href=\"/leads/out\">Sign out</a>" +
    "</div>" + banner + "</div>";

  const src = await env.BUNDLES.get(HTML_KEY);
  if (!src) return redirect("/api/my-leads?t=" + token); // raced with a re-upload

  logAccess(context, token, "ok");

  const base = new Response(src.body, {
    status: 200,
    headers: sec({ "Content-Type": "text/html; charset=utf-8" }),
  });
  // FOURTH INJECTION, beyond §2.5's three, and the reason is §6.1.
  // The bundle header renders `<span class="fresh">updated {today}</span>` in
  // GREEN (--good), where {today} is `date.today()` on the build machine
  // (build_bundle.py:185). It has no causal relationship to the data: a
  // successful build over stale scraped rows stamps today's date on rows nobody
  // refreshed, so it is a number that is right every time and means nothing.
  // In an email that was decoration — the message ARRIVING was the freshness
  // signal. On a URL the customer returns to, it is the loudest freshness claim
  // on the page, and leaving it green above an amber banner is precisely the
  // "no signal anything is wrong" failure §1.2 exists to prevent.
  //
  // So it is replaced, from the Function, at request time, with the R2 upload
  // time of THIS object — the only timestamp in the system that goes stale when
  // the pipeline stops — and de-greened whenever the banner is not grey.
  // If a future bundle drops the span the selector simply matches nothing and
  // the banner still carries the truth; nothing breaks.
  const freshText = Number.isFinite(tHtml)
    ? "published " + iso(tHtml)
    : "publish date unknown";
  const freshStyle = notes.length ? "color:#fbbf24" : "color:#8aa0b6";

  return new HTMLRewriter()
    .on("head", { element(e) { e.append(HEAD_INJECT, { html: true }); } })
    .on("body", { element(e) { e.prepend(bar, { html: true }); } })
    .on("span.fresh", {
      element(e) {
        e.setInnerContent(freshText); // text, not html — never interpolated
        e.setAttribute("style", freshStyle);
      },
    })
    .transform(base);
}

// ---------------------------------------------------------------------------
// INJECTED HEAD: noindex meta + the portal chrome + the mobile block
// ---------------------------------------------------------------------------
//
// MOBILE IS REQUIRED, NOT POLISH (§2.6). One of the two customers this portal
// exists for bought on a phone. The bundle has a single @media(max-width:900px)
// that never touches the table, and the table lives in
// `.scroll{max-height:68vh;overflow:auto}` — a nested scroll region under a
// sticky header, the classic trap where the customer's swipe scrolls the wrong
// thing. Hosting that unchanged converts "I can't open a ZIP" into "I opened it
// and can't use it."
//
// KB/07 puts this block in build_bundle.py (Stage A2), which is correct and
// also improves the ZIP for everyone. Stage A is NOT built. Shipping the portal
// without it would fail §2.6, so the same rules are injected here — the
// Function deploys by git push in ~1 minute, the renderer only via a
// hand-assembled tarball. When A2 lands, these rules become a harmless
// duplicate and this block can be deleted.
const HEAD_INJECT =
  "<meta name=\"robots\" content=\"noindex,nofollow,noarchive,nosnippet\">" +
  "<style>" +
  "#mp-portal{font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}" +
  "#mp-portal .mp-bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:9px 22px;" +
  "background:#0b1420;border-bottom:1px solid #26384d;color:#8ea3b9;font-size:12.5px}" +
  "#mp-portal .mp-bar b{color:#eaf1f8;font-weight:700}" +
  "#mp-portal .mp-out{margin-left:auto;color:#2dd4bf;text-decoration:none;border:1px solid #26384d;" +
  "border-radius:8px;padding:6px 12px;white-space:nowrap}" +
  "#mp-portal .mp-out:hover{border-color:#2dd4bf;text-decoration:none}" +
  "#mp-portal .mp-note{padding:12px 22px;font-size:13.5px;line-height:1.6}" +
  "#mp-portal .mp-note p{margin:0 0 8px}#mp-portal .mp-note p:last-child{margin:0}" +
  "#mp-portal .mp-grey{background:#0d1825;color:#8ea3b9;border-bottom:1px solid #26384d}" +
  "#mp-portal .mp-amber{background:#2b1f06;color:#f3e0b4;border-bottom:2px solid #fbbf24}" +
  "#mp-portal .mp-amber b{color:#fbbf24}" +
  "#mp-portal .mp-dim{opacity:.75}" +
  "@media(max-width:640px){" +
  ".top{position:static}.bar{padding:11px 13px;gap:9px}.tagline{display:none}" +
  ".meta{margin-left:0;text-align:left;width:100%}" +
  ".wrap{padding:14px 12px 40px}" +
  ".stats{grid-template-columns:1fr;gap:10px}.dash{grid-template-columns:1fr}" +
  ".howto{grid-template-columns:1fr}.mgrid{grid-template-columns:1fr}" +
  /* kill the nested vertical scroll: with no max-height the region cannot
     scroll vertically, so a vertical swipe reaches the page and only sideways
     panning stays inside the table. */
  ".scroll{max-height:none}" +
  // The base stylesheet sets white-space:nowrap on every <th>, on .pill (the
  // trade badge, "Renovation-Remodel") and on .val. On a 375px screen those
  // three alone hold the table at ~800px and force sideways panning to reach
  // the value and the permit holder. Let them wrap; keep .val nowrap so a
  // dollar figure never breaks mid-number.
  "table{font-size:14px}tbody td{padding:13px 9px}thead th{padding:10px 9px;white-space:normal}" +
  ".pill{white-space:normal}.addr{word-break:break-word}" +
  ".controls{gap:8px}.controls input,.controls select{width:100%}#q{min-width:0;width:100%}" +
  ".viewtog{width:100%}.viewtog button{flex:1}" +
  ".sheet{padding:18px 16px;max-height:92vh}" +
  "#mp-portal .mp-bar,#mp-portal .mp-note{padding-left:13px;padding-right:13px}" +
  /* Hide the two lowest-value columns on a phone (Source, Project) so address,
     town, date, trade, value and the permit holder fit. Scoped with :has() to
     the PERMITS header only — the by-contractor view reuses the same <table>
     with a 5-column header where column 2 is "Jobs". A browser without :has()
     drops the rule and keeps every column: degrades, never breaks. */
  "table:has(thead th[data-s='d']) thead th:nth-child(2)," +
  "table:has(thead th[data-s='d']) tbody td:nth-child(2)," +
  "table:has(thead th[data-s='d']) thead th:nth-child(6)," +
  "table:has(thead th[data-s='d']) tbody td:nth-child(6){display:none}" +
  "}" +
  // Phone proper. Measured on a 375x812 viewport against a real WEEKLY bundle
  // (2026-08-13, 5,702 rows). With only Source and Project hidden the table is
  // still 695px wide: the value and the permit holder are two sideways swipes
  // away and the address — the field the customer actually reads — collapses to
  // a 70px column. So below 480px two more columns drop and the remaining four
  // get fixed shares that add up to the screen. No sideways panning.
  //
  // DEVIATION FROM §2.6, STATED. The spec keeps five (address, town, date,
  // trade, value). Measured, the trade badge cannot have a useful column here:
  // at any width that leaves the address readable it renders as a 56px stub
  // ("Renovation-Remodel" -> an icon and one letter). It is dropped instead of
  // shown truncated, because the trade is already the primary filter directly
  // above the table (the chip row, with counts) and is in the tap-through
  // detail modal. Permit holder goes the same way and for the same reason;
  // the by-contractor view is untouched, since :has() scopes every rule here to
  // the permits header. A browser without :has() keeps all eight columns and
  // pans sideways: degraded, never broken.
  "@media(max-width:480px){" +
  "table:has(thead th[data-s='d']) thead th:nth-child(5)," +
  "table:has(thead th[data-s='d']) tbody td:nth-child(5)," +
  "table:has(thead th[data-s='d']) thead th:nth-child(8)," +
  "table:has(thead th[data-s='d']) tbody td:nth-child(8){display:none}" +
  "table:has(thead th[data-s='d']){table-layout:fixed;width:100%}" +
  "table:has(thead th[data-s='d']) thead th:nth-child(1){width:16%}" +
  "table:has(thead th[data-s='d']) thead th:nth-child(3){width:24%}" +
  "table:has(thead th[data-s='d']) thead th:nth-child(4){width:40%}" +
  "table:has(thead th[data-s='d']) thead th:nth-child(7){width:20%}" +
  "tbody td{padding:12px 8px;overflow-wrap:break-word}" +
  // Town names are single long words: "Foxborough" at 14px needs 78px and
  // breaks mid-word in an 84px column. 12px fits it.
  "table:has(thead th[data-s='d']) tbody td:nth-child(3){font-size:12px}" +
  ".val{font-size:13px}" +
  "}" +
  "</style>";

// ---------------------------------------------------------------------------
// THE INACTIVE-SUBSCRIBER PAGE (§2.7) — COUNTS ONLY
// ---------------------------------------------------------------------------
// No addresses, no contractor names, no rows, not even masked ones.
// _mask_for_sample() has a MEASURED hole (146 of 36,117 rows carry a full
// house-number address inside `description`, 7 repeat the contractor name), so
// hosting masked rows at a stable URL would turn a ZIP-bound flaw into an
// indexed one. Reactivation already works end to end: the webhook flips
// `active` back to true and REUSES the same token, so this customer's existing
// link starts working the moment they pay.
async function inactivePage(env, hadCookie) {
  const status = await readJson(env, "refresh-status.json");
  // Every number below names its producer: refresh-status.json is written by
  // hosted_refresh._write_status(); `count` is scraper.refresh()'s row count and
  // coverage.live_sources is the count of sources that returned rows.
  const rows = status && typeof status.count === "number" ? status.count : null;
  const live = status && status.coverage && typeof status.coverage.live_sources === "number"
    ? status.coverage.live_sources : null;
  const headline = (rows !== null || live !== null)
    ? "<p><b>This week:</b> " +
      (rows !== null ? rows.toLocaleString("en-US") + " permit records" : "our current corpus") +
      (live !== null ? " across " + live + " live town sources" : "") + ".</p>"
    : "";
  return page(403, "Your MassPermits subscription has ended",
    headline +
    "<p>Your leads are still being collected every week — they are just not yours to " +
    "open right now.</p>" +
    "<p><a class=\"mp-cta\" href=\"" + RESUB + "\">Resubscribe &rarr;</a></p>" +
    "<p class=\"mp-dim\">If you think this is wrong — you paid and this still says ended — " +
    "reply to your last email and we will fix it the same day.</p>",
    hadCookie ? { "Set-Cookie": clearCookie() } : null);
}

// ---------------------------------------------------------------------------
// THE ACCESS LOG (§3.7) — the first telemetry this business has ever had on
// whether a customer opened their data. my-leads.js writes nothing and there is
// no Resend webhook, so nobody knows whether that fallback button has ever been
// clicked, even once.
// Never the full token. Never the email. Never a path string.
// Aggregates read customMetadata only (never object bodies), matching
// funnel.js/traffic.js, so a growing log stays inside the subrequest budget.
// ---------------------------------------------------------------------------
function logAccess(context, token, state) {
  try {
    const { request, env } = context;
    // GET only. A HEAD is a curl or an uptime probe, never a customer reading
    // their leads, and this log's whole value is that it answers "did anyone
    // open it" — one operator probe a week would poison that from day one.
    if (request.method !== "GET") return;
    const ua = request.headers.get("user-agent") || "";
    const day = new Date().toISOString().slice(0, 10);
    const key = "portal-access/" + day + "/" + Date.now() + "-" +
      crypto.randomUUID().slice(0, 8);
    const meta = {
      tok: String(token).slice(0, 8), // 8 hex = enough to tell subscribers apart, useless as a credential
      ua: /Mobi|Android|iPhone|iPad|iPod/i.test(ua) ? "mobile" : "desktop",
      st: state, // "ok" | "red" — a customer meeting the stale page is worth knowing
    };
    const cc = String((request.cf && request.cf.country) || "").replace(/[^A-Za-z]/g, "").slice(0, 2);
    if (cc) meta.cc = cc;
    // waitUntil: telemetry must never delay or fail a delivery.
    context.waitUntil(env.BUNDLES.put(key, "", { customMetadata: meta }).catch(() => {}));
  } catch (_) { /* never break the page on bookkeeping */ }
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

// A1: all four headers, set IN CODE on every response. A _headers file does not
// apply to Pages Function responses — that is why this cannot live there.
// Cache-Control and Vary are not optional: a clean tokenless /leads is a perfect
// cache key, and this codebase already ships `public, max-age=3600` on a
// Function response (sample.js), so the precedent for getting it wrong is here.
function sec(extra) {
  const h = {
    "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "private, no-store",
    "Vary": "Cookie",
  };
  if (extra) for (const k of Object.keys(extra)) h[k] = extra[k];
  return h;
}

function clearCookie() {
  return COOKIE + "=; HttpOnly; Secure; SameSite=Lax; Path=/leads; Max-Age=0";
}

function cookieToken(request) {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim();
  }
  return "";
}

function redirect(location) {
  return new Response(null, { status: 302, headers: sec({ Location: location }) });
}

// A10: a malformed subscribers.json returns 503, NEVER 200-with-empty and never
// 403 — a storage blip must not read as revocation. Message copied from
// my-leads.js verbatim, including the pointer at the emailed attachment.
function unavailable() {
  return page(503, "Temporarily unavailable",
    "<p>Temporarily unavailable — please try the emailed attachment.</p>" +
    "<p class=\"mp-dim\">This is a problem on our side, not with your subscription. " +
    "The <b>Download your leads</b> button in your email is unaffected.</p>");
}

async function lookup(env, token) {
  let obj;
  try {
    obj = await env.BUNDLES.get("subscribers.json");
  } catch (_) {
    return { error: true };
  }
  // A MISSING object is not an empty subscriber list. my-leads.js treats it as
  // one (get() returns null without throwing, so subs stays [] and every live
  // subscriber is told their link is dead) — a missing file reading as mass
  // revocation. Not repeated here: absent => 503, same as unparseable.
  if (!obj) return { error: true };
  let subs;
  try {
    subs = JSON.parse(await obj.text());
  } catch (_) {
    return { error: true };
  }
  if (!Array.isArray(subs)) return { error: true };
  // `active !== false`, not `active === true`: a legacy record with no `active`
  // field still works. Revoked and never-existed are deliberately not
  // distinguished anywhere downstream — no enumeration oracle.
  return { sub: subs.find((s) => s && s.token === token && s.active !== false) || null };
}

async function readKillSwitch(env) {
  try {
    const o = await env.BUNDLES.get("portal.json");
    if (!o) return null; // absent = portal on. This is the normal state.
    try {
      return JSON.parse(await o.text());
    } catch (_) {
      // Present but unreadable. The ONLY reason this object exists is to turn
      // the portal off, so a broken one fails SAFE (off), not open.
      return { off: true, message: "" };
    }
  } catch (_) {
    return null; // an R2 blip must not take the portal down by itself
  }
}

async function readJson(env, key) {
  try {
    const o = await env.BUNDLES.get(key);
    return o ? JSON.parse(await o.text()) : null;
  } catch { return null; }
}

async function headSafe(env, key) {
  try { return await env.BUNDLES.head(key); } catch { return null; }
}

function iso(ms) { return new Date(ms).toISOString().slice(0, 10); }

function minutesApart(a, b) {
  const m = Math.round(Math.abs(a - b) / 60000);
  return m >= 120 ? Math.round(m / 60) + " hours" : m + " minutes";
}

function num(v, fallback) {
  return (typeof v === "number" && Number.isFinite(v)) ? String(v) : fallback;
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (m) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

// Standalone page. Modelled on newsletter.js's page() helper — the one existing
// precedent for rendering HTML from a Function — using ops.html's palette
// (the only one in the repo with --warn/--bad). Carries NO page-view beacon
// (A4), no rows, no names, no counts beyond what the caller passes in.
function page(status, headline, bodyHtml, extraHeaders, tone) {
  const accent = tone === "bad" ? "#f87171" : tone === "warn" ? "#fbbf24" : "#2dd4bf";
  const html = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">" +
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    "<meta name=\"robots\" content=\"noindex,nofollow,noarchive,nosnippet\">" +
    "<title>MassPermits</title>" +
    "<link rel=\"icon\" href=\"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>&#128203;</text></svg>\">" +
    "<style>" +
    "body{margin:0;background:#0e1622;color:#e8eef5;line-height:1.55;" +
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;" +
    "display:flex;align-items:center;justify-content:center;min-height:100vh}" +
    ".wrap{max-width:520px;padding:36px 22px}" +
    ".brand{font-size:20px;font-weight:800;letter-spacing:-.4px;margin-bottom:20px}" +
    ".brand span{color:#2dd4bf}" +
    "h1{font-size:24px;font-weight:800;letter-spacing:-.3px;margin:0 0 12px;color:" + accent + "}" +
    "p{color:#c7d3e0;margin:0 0 12px;font-size:15px}" +
    "b{color:#e8eef5}" +
    ".mp-dim{color:#8aa0b6;font-size:13.5px}" +
    "a{color:#2dd4bf;text-decoration:none}a:hover{text-decoration:underline}" +
    ".mp-cta{display:inline-block;background:#2dd4bf;color:#04201c;font-weight:800;" +
    "padding:11px 20px;border-radius:9px;margin-top:6px}" +
    ".mp-cta:hover{background:#14b8a6;text-decoration:none}" +
    "@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}" +
    "</style></head><body><div class=\"wrap\">" +
    "<div class=\"brand\">Mass<span>Permits</span></div>" +
    "<h1>" + headline + "</h1>" + bodyHtml +
    "<p class=\"mp-dim\">MassPermits &middot; <a href=\"https://masspermits.com/\">masspermits.com</a></p>" +
    "</div></body></html>";
  return new Response(html, {
    status,
    headers: sec(Object.assign({ "Content-Type": "text/html; charset=utf-8" }, extraHeaders || {})),
  });
}

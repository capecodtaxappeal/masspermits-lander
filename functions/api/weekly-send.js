// MassPermits — weekly feed sender (Pages Function).
//
// Closes the gap where "Weekly Feed" subscribers were only delivered on Stripe
// payment events. Emails EVERY active subscriber (from R2 "subscribers.json") the
// current latest-weekly.zip. Triggered weekly by a GitHub Actions cron (see
// .github/workflows/weekly-feed.yml). Reuses the project's existing bindings:
//   RESEND_API_KEY, FROM_EMAIL (env)  +  BUNDLES (R2)
// so NO new secret has to be created.
//
// Auth: GitHub Actions OIDC (see _github-oidc.js). The previous static query
// token is dead — it was committed to a public repo, so anyone could have
// triggered sends. OIDC is keyless and pinned to this repo's main branch.

import { verifyGitHubOIDC } from "./_github-oidc.js";

export async function onRequest(context) {
  const { request, env } = context;
  const auth = await verifyGitHubOIDC(request);
  if (!auth.ok) {
    return json({ error: "unauthorized", reason: auth.reason }, 401);
  }
  try {
    // Freshness gate: never mail a stale bundle. The 09:00 UTC refresh writes
    // refresh-status.json on success; if that's over 8 days old the refresh has
    // been failing, so ABORT with a 500 — the Actions curl then fails and
    // GitHub emails the owner. Failing loudly beats shipping old data.
    // 2026-08-03: this gate silently cost two paying subscribers their Monday
    // delivery. It was written to stop us mailing STALE data, and it did that —
    // by mailing nothing at all, for three weeks running had nobody noticed.
    // For someone who paid for a weekly feed, silence is the worst outcome on
    // the board: worse than reduced coverage, worse than a late file.
    //
    // So the gate now distinguishes two different failures:
    //   STALE  -> genuinely old or crashed. Still abort; old data is a lie.
    //   DEGRADED -> the scrape ran, today, and got real rows for fewer sources
    //               than usual. SEND IT, with the shortfall stated up front.
    // A degraded run is a smaller truthful file. That is a thing we can deliver.
    let coverage = null;
    const st = await env.BUNDLES.get("refresh-status.json");
    if (st) {
      const status = JSON.parse(await st.text());
      const age = Date.now() - Date.parse(status.ran_at || 0);
      const fresh = age < 8 * 86400_000;
      if (!fresh) {
        return json({ ok: false, error: "data refresh is stale (last: " +
          (status.ran_at || "never") + ") — send aborted so this fails visibly" }, 500);
      }
      if (status.ok === false && !status.degraded) {
        return json({ ok: false, error: "last refresh FAILED (" +
          (status.error || "unknown") + ") — send aborted so this fails visibly" }, 500);
      }
      if (status.degraded) coverage = status.coverage || { note: "reduced coverage" };
    }

    let subs = [];
    const so = await env.BUNDLES.get("subscribers.json");
    if (so) subs = JSON.parse(await so.text());
    subs = (subs || []).filter((s) => s && s.email && s.active !== false);
    if (!subs.length) return json({ ok: true, note: "no active subscribers" });

    // NOTE: weekly-send is READ-ONLY on subscribers.json. Tokens for the
    // /api/my-leads download button are minted by the Stripe webhook when a
    // subscriber is added (the only writer), so there is no second concurrent
    // writer to race. A subscriber without a token (shouldn't happen after the
    // one-time backfill) simply gets the email with no download button.

    const file = await env.BUNDLES.get("latest-weekly.zip");
    if (!file) return json({ ok: false, error: "no latest-weekly.zip in R2" }, 500);
    const b64 = base64(await file.arrayBuffer());

    // ATTEMPT MARKER, written before the first email goes out.
    // The 2026-08-03 miss was invisible because feed-send-log.json is only
    // written AFTER a successful run — so "no send happened" and "the send ran
    // but the log write failed" looked identical, which meant nothing could
    // safely alert or retry. This marker separates them: no marker => we never
    // got here => a retry cannot double-send.
    try {
      await env.BUNDLES.put("last-send-attempt.json", JSON.stringify({
        at: new Date().toISOString(), subscribers: subs.length, degraded: !!coverage }));
    } catch (_) { /* never block a delivery on bookkeeping */ }

    const sent = [];
    for (const s of subs) {
      try {
        const ok = await sendEmail(env, s.email, s.name || "", b64, s.token || "", coverage);
        sent.push({ to: s.email, ok });
      } catch (e) {
        sent.push({ to: s.email, ok: false, error: String(e && e.message || e).slice(0, 120) });
      }
    }
    // Persist per-recipient results to R2. The Actions log that shows this
    // response needs repo-admin auth — when a paying subscriber said "I never
    // get my emails" (Silvestre, 2026-07-20), there was NO readable record of
    // whether their sends were ever attempted or how they failed. Same
    // black-box pattern as refresh-status.json. Keeps the last 12 sends.
    try {
      const lo = await env.BUNDLES.get("feed-send-log.json");
      const log = lo ? JSON.parse(await lo.text()) : [];
      log.unshift({ at: new Date().toISOString(), subscribers: subs.length, sent, coverage });
      await env.BUNDLES.put("feed-send-log.json", JSON.stringify(log.slice(0, 12)));
    } catch (_) { /* logging must never fail the send */ }
    return json({ ok: true, subscribers: subs.length, sent });
  } catch (e) {
    return json({ ok: false, error: String(e && e.message || e) }, 500);
  }
}

async function sendEmail(env, to, name, b64, token, coverage) {
  const first = name ? " " + name.split(" ")[0] : "";
  const d = new Date().toISOString().slice(0, 10);
  // Self-serve download button — the always-works fallback when a spam filter
  // strips or quarantines the attachment (see functions/api/my-leads.js).
  const dl = token
    ? '<p style="margin:18px 0"><a href="https://masspermits.com/api/my-leads?t=' + token + '" ' +
      'style="background:#0e7c6b;color:#fff;font-weight:700;padding:11px 20px;border-radius:8px;' +
      'text-decoration:none;display:inline-block">Download this week\'s leads &rarr;</a></p>' +
      '<p style="color:#667;font-size:12.5px">Attachment not showing? Use the button above — same file, ' +
      'straight from masspermits.com. Add leads@masspermits.com to your contacts so it always reaches your inbox.</p>'
    : "";
  // Stated ABOVE the file, not buried under it. A subscriber should learn what
  // is missing from us, in the same email — not by counting rows themselves.
  const note = coverage ? (
    '<div style="background:#fff8e1;border:1px solid #f0b429;border-radius:10px;padding:14px 16px;margin:0 0 18px">' +
    '<p style="margin:0 0 8px;font-weight:700;color:#8a5a00">Reduced coverage this week — please read</p>' +
    `<p style="margin:0 0 8px;color:#5c4300;font-size:14px">This file covers <b>${coverage.live_sources || "fewer"} of ` +
    `${coverage.expected_sources || "our usual"}</b> town sources. On 1 August our largest upstream provider closed ` +
    `public access to its permit records, which removed ${coverage.lost_sources || "many"} towns at once — including ` +
    'most of Cape Cod, MetroWest, the North Shore, and Central and Western Massachusetts.</p>' +
    '<p style="margin:0;color:#5c4300;font-size:14px">Everything in the attached file is real and current. ' +
    'We are rebuilding the missing towns from their own municipal sources and will tell you as they come back. ' +
    'If a reduced feed is not worth your subscription in the meantime, reply and we will refund you — no argument.</p></div>'
  ) : "";
  const html =
    '<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:560px;color:#0e1622">' +
    '<h2 style="color:#0e7c6b">This week\'s MassPermits leads 📋</h2>' +
    note +
    `<p>Hi${first}, your building-permit leads for the week are attached.</p>` +
    '<p><b>Open MassPermits-Leads.html</b> in any browser — interactive dashboard: live charts, ' +
    'filter by trade &amp; town, look up any contractor\'s active jobs, and click any permit for the ' +
    'full record. CSVs included too.</p>' +
    dl +
    '<p style="color:#667;font-size:13px">Sourced from public municipal building-permit records. ' +
    'Just reply with any questions.<br>— MassPermits · masspermits.com</p></div>';
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.FROM_EMAIL, to: [to],
      subject: coverage ? "Your weekly MassPermits leads — reduced coverage, please read"
                        : "Your weekly MassPermits leads",
      html,
      attachments: [{ filename: `MassPermits-weekly-${d}.zip`, content: b64 }],
    }),
  });
  if (!resp.ok) throw new Error("resend " + resp.status + " " + (await resp.text()).slice(0, 160));
  return true;
}

function base64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

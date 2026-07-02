// MassPermits — weekly feed sender (Pages Function).
//
// Closes the gap where "Weekly Feed" subscribers were only delivered on Stripe
// payment events. Emails EVERY active subscriber (from R2 "subscribers.json") the
// current latest-weekly.zip. Triggered weekly by a GitHub Actions cron (see
// .github/workflows/weekly-feed.yml). Reuses the project's existing bindings:
//   RESEND_API_KEY, FROM_EMAIL (env)  +  BUNDLES (R2)
// so NO new secret has to be created. Protected by a trigger token in the query.

const TRIGGER_TOKEN = "mpwk_k9Qw3Zr7Tp2Xv8Ln4Bd6Hs";

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  if (url.searchParams.get("k") !== TRIGGER_TOKEN) {
    return json({ error: "unauthorized" }, 401);
  }
  try {
    let subs = [];
    const so = await env.BUNDLES.get("subscribers.json");
    if (so) subs = JSON.parse(await so.text());
    subs = (subs || []).filter((s) => s && s.email && s.active !== false);
    if (!subs.length) return json({ ok: true, note: "no active subscribers" });

    const file = await env.BUNDLES.get("latest-weekly.zip");
    if (!file) return json({ ok: false, error: "no latest-weekly.zip in R2" }, 500);
    const b64 = base64(await file.arrayBuffer());

    const sent = [];
    for (const s of subs) {
      try {
        const ok = await sendEmail(env, s.email, s.name || "", b64);
        sent.push({ to: s.email, ok });
      } catch (e) {
        sent.push({ to: s.email, ok: false, error: String(e && e.message || e).slice(0, 120) });
      }
    }
    return json({ ok: true, subscribers: subs.length, sent });
  } catch (e) {
    return json({ ok: false, error: String(e && e.message || e) }, 500);
  }
}

async function sendEmail(env, to, name, b64) {
  const first = name ? " " + name.split(" ")[0] : "";
  const d = new Date().toISOString().slice(0, 10);
  const html =
    '<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:560px;color:#0e1622">' +
    '<h2 style="color:#0e7c6b">This week\'s MassPermits leads 📋</h2>' +
    `<p>Hi${first}, your fresh building-permit leads for the week are attached.</p>` +
    '<p><b>Open MassPermits-Leads.html</b> in any browser — interactive dashboard: live charts, ' +
    'filter by trade &amp; town, look up any contractor\'s active jobs, and click any permit for the ' +
    'full record. CSVs included too.</p>' +
    '<p style="color:#667;font-size:13px">Sourced from public municipal building-permit records. ' +
    'Just reply with any questions.<br>— MassPermits · masspermits.com</p></div>';
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.FROM_EMAIL, to: [to], subject: "Your weekly MassPermits leads", html,
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

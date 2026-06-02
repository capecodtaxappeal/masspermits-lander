// MassPermits — Stripe webhook → auto-deliver the lead bundle.
//
// Cloudflare Pages Function (deploys with the site; no separate Worker). Stripe
// calls this on payment events; we verify the signature, decide which bundle to
// send, pull it from R2, and email it via Resend — fully hands-off.
//
// Delivery logic (the value-inversion fix from the design pass):
//   checkout.session.completed, mode=payment        -> ONE-TIME Lead Pack -> MONTHLY bundle
//   checkout.session.completed, mode=subscription    -> NEW subscriber     -> MONTHLY bundle (start big)
//   invoice.paid (billing_reason=subscription_cycle) -> RENEWAL            -> WEEKLY delta bundle
//   invoice.paid (billing_reason=subscription_create)-> first invoice      -> SKIP (checkout.session already handled it)
//
// Required env (Cloudflare Pages → Settings → Variables & Secrets):
//   STRIPE_WEBHOOK_SECRET  - the signing secret from the Stripe webhook endpoint (whsec_...)
//   RESEND_API_KEY         - Resend API key (re_...)
//   FROM_EMAIL             - e.g. "MassPermits <leads@masspermits.com>" (verified Resend domain)
//   BUNDLES (R2 binding)   - R2 bucket holding latest-monthly.zip / latest-weekly.zip
//
// R2 object keys this expects (uploaded by the local weekly_refresh):
//   latest-monthly.zip , latest-weekly.zip

export async function onRequestPost(context) {
  const { request, env } = context;
  const sig = request.headers.get("stripe-signature") || "";
  const raw = await request.text();

  // 1. Verify Stripe signature (HMAC-SHA256 over `${t}.${payload}`)
  const ok = await verifyStripeSig(raw, sig, env.STRIPE_WEBHOOK_SECRET);
  if (!ok) return new Response("bad signature", { status: 400 });

  let event;
  try { event = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }

  try {
    const decision = decideDelivery(event);
    if (!decision) return json({ ok: true, skipped: event.type });

    const { email, bundleKey, kind, ref } = decision;
    if (!email) return json({ ok: true, note: "no email on event", type: event.type });

    const file = await env.BUNDLES.get(bundleKey);
    if (!file) return json({ ok: false, error: `bundle ${bundleKey} not in R2` }, 500);
    const bytes = await file.arrayBuffer();

    await sendEmail(env, email, kind, ref, bytes, bundleKey);
    return json({ ok: true, delivered: kind, to: email, bundle: bundleKey });
  } catch (e) {
    return json({ ok: false, error: String(e && e.message || e) }, 500);
  }
}

// Decide which bundle (if any) to send for this event.
function decideDelivery(event) {
  const o = event.data && event.data.object || {};
  if (event.type === "checkout.session.completed") {
    const email = o.customer_details?.email || o.customer_email || "";
    const ref = o.client_reference_id || "";
    // subscription OR one-time both get the big MONTHLY batch as the first send
    return { email, ref, bundleKey: "latest-monthly.zip", kind: "monthly" };
  }
  if (event.type === "invoice.paid") {
    // Only RENEWALS here — the very first subscription invoice is covered by
    // checkout.session.completed, so skip billing_reason=subscription_create.
    if (o.billing_reason !== "subscription_cycle") return null;
    const email = o.customer_email || (o.customer_address && o.customer_address.email) || "";
    return { email, ref: "", bundleKey: "latest-weekly.zip", kind: "weekly" };
  }
  return null;
}

async function sendEmail(env, to, kind, ref, bytes, filename) {
  const human = kind === "weekly" ? "this week's fresh" : "your";
  const refLine = ref ? `<p style="color:#667">Your selection: <b>${escapeHtml(ref.replace(/__/g," · "))}</b></p>` : "";
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0e1622">
      <h2 style="color:#0e7c6b">Your MassPermits leads are attached 📋</h2>
      <p>Thanks for your order. Attached is ${human} building-permit lead bundle.</p>
      ${refLine}
      <p><b>Open <code>MassPermits-Leads.html</code></b> in any browser — search, filter by trade &amp; town, sort, and click any address to map it. The CSVs are there too (one master + one per trade).</p>
      <p style="color:#667;font-size:13px">Sourced from public municipal building-permit records.<br>
      Questions? Just reply to this email.</p>
      <p style="color:#9aa;font-size:12px">— MassPermits · masspermits.com</p>
    </div>`;
  const b64 = base64(bytes);
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: [to],
      subject: kind === "weekly" ? "Your weekly MassPermits leads" : "Your MassPermits lead pack",
      html,
      attachments: [{ filename: niceName(filename, kind), content: b64 }],
    }),
  });
  if (!resp.ok) throw new Error("resend " + resp.status + " " + (await resp.text()).slice(0, 200));
}

function niceName(_key, kind) {
  const d = new Date().toISOString().slice(0, 10);
  return `MassPermits-${kind}-${d}.zip`;
}

// ── Stripe signature verification (Web Crypto, no SDK) ───────────────────────
async function verifyStripeSig(payload, header, secret) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(",").map(kv => kv.split("=")));
  const t = parts.t, v1 = parts.v1;
  if (!t || !v1) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${payload}`));
  const expected = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, "0")).join("");
  // constant-time-ish compare
  if (expected.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}

function base64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk)
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
}
function escapeHtml(s){return String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

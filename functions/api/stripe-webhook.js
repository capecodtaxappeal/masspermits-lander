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
  const verdict = await verifyStripeSig(raw, sig, env.STRIPE_WEBHOOK_SECRET);
  if (!verdict.ok) {
    // Minimal, non-sensitive reason for observability; no secret/HMAC material leaked.
    return json({ error: "bad signature", reason: verdict.reason }, 400);
  }

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
    // add new SUBSCRIBERS (not one-time pack buyers) to the weekly-feed list in R2
    if (kind === "monthly" && ((event.data && event.data.object) || {}).mode === "subscription") {
      await addSubscriber(env, email, event);
    }
    return json({ ok: true, delivered: kind, to: email, bundle: bundleKey });
  } catch (e) {
    return json({ ok: false, error: String(e && e.message || e) }, 500);
  }
}

// This Stripe account is SHARED with another product (IRWatch, ~$4.35/mo). Its
// invoice.paid / checkout.session.completed events hit THIS endpoint too, so
// without a filter we email MassPermits data to IRWatch customers. MassPermits
// products are $49 (pack) / $99 (weekly feed); a $10 floor cleanly separates them
// from the $4.35 product. (Follow-up: swap to an explicit MassPermits price-ID
// allowlist if a cheaper MassPermits tier is ever added.)
const MIN_CENTS = 1000;

// Decide which bundle (if any) to send for this event.
function decideDelivery(event) {
  const o = event.data && event.data.object || {};
  if (event.type === "checkout.session.completed") {
    if ((o.amount_total || 0) < MIN_CENTS) return null; // not a MassPermits product
    const email = o.customer_details?.email || o.customer_email || "";
    const ref = o.client_reference_id || "";
    // subscription OR one-time both get the big MONTHLY batch as the first send
    return { email, ref, bundleKey: "latest-monthly.zip", kind: "monthly" };
  }
  if (event.type === "invoice.paid") {
    // Only RENEWALS here — the very first subscription invoice is covered by
    // checkout.session.completed, so skip billing_reason=subscription_create.
    if (o.billing_reason !== "subscription_cycle") return null;
    if ((o.amount_paid || o.total || 0) < MIN_CENTS) return null; // not a MassPermits product
    const email = o.customer_email || (o.customer_address && o.customer_address.email) || "";
    return { email, ref: "", bundleKey: "latest-weekly.zip", kind: "weekly" };
  }
  return null;
}

// Maintain the weekly-feed subscriber list in R2 (read by /api/weekly-send).
async function addSubscriber(env, email, event) {
  try {
    const o = (event.data && event.data.object) || {};
    const cur = await env.BUNDLES.get("subscribers.json");
    const list = cur ? JSON.parse(await cur.text()) : [];
    if (!list.some((s) => s.email === email)) {
      list.push({
        email,
        name: (o.customer_details && o.customer_details.name) || "",
        since: new Date().toISOString().slice(0, 10),
        active: true,
      });
      await env.BUNDLES.put("subscribers.json", JSON.stringify(list));
    }
  } catch (e) {
    /* non-fatal — the bundle was already delivered */
  }
}

async function sendEmail(env, to, kind, ref, bytes, filename) {
  const human = kind === "weekly" ? "this week's fresh" : "your";
  const refLine = ref ? `<p style="color:#667">Your selection: <b>${escapeHtml(ref.replace(/__/g," · "))}</b></p>` : "";
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0e1622">
      <h2 style="color:#0e7c6b">Your MassPermits leads are attached 📋</h2>
      <p>Thanks for your order. Attached is ${human} building-permit lead bundle.</p>
      ${refLine}
      <p><b>Open <code>MassPermits-Leads.html</code></b> in any browser — it's a full interactive dashboard: live charts, search &amp; filter by trade &amp; town, sort by project value, look up any contractor's active jobs, and click any permit for the complete record. The CSVs are included too (one master + one per trade).</p>
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
  if (!secret) return { ok: false, reason: "no-secret-in-env" };
  if (!header) return { ok: false, reason: "no-signature-header" };
  // Stripe header: "t=...,v1=...,v1=..."  (may carry multiple v1 schemes)
  const kvs = header.split(",").map(kv => kv.split("="));
  const t = (kvs.find(([k]) => k === "t") || [])[1];
  const v1s = kvs.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || v1s.length === 0) return { ok: false, reason: "header-missing-t-or-v1" };
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret.trim()),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${payload}`));
  const expected = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, "0")).join("");
  for (const v1 of v1s) {
    if (expected.length === v1.length) {
      let diff = 0;
      for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
      if (diff === 0) return { ok: true };
    }
  }
  return {
    ok: false,
    reason: "hmac-mismatch",
    computedPrefix: expected.slice(0, 10),
    gotPrefix: (v1s[0] || "").slice(0, 10),
  };
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

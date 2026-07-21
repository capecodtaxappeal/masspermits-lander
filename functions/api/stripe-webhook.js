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
    // Churn: deactivate weekly-feed subscribers when their subscription ends,
    // so cancelled customers stop receiving the paid bundle. (Requires the
    // Stripe webhook destination to also subscribe to customer.subscription.deleted.)
    if (event.type === "customer.subscription.deleted") {
      const o = (event.data && event.data.object) || {};
      const n = await deactivateSubscriber(env, o.customer);
      return json({ ok: true, deactivated: n });
    }

    const decision = decideDelivery(event);
    if (!decision) return json({ ok: true, skipped: event.type });

    const { email, bundleKey, kind, ref } = decision;
    if (!email) return json({ ok: true, note: "no email on event", type: event.type });

    const file = await env.BUNDLES.get(bundleKey);
    if (!file) return json({ ok: false, error: `bundle ${bundleKey} not in R2` }, 500);
    const bytes = await file.arrayBuffer();

    // Referral loop — NEW purchases only. Renewal emails (kind="weekly", existing
    // subscribers) deliberately carry no referral block yet, per owner decision.
    let myCode = "";
    if (kind === "monthly") {
      try { myCode = await mintReferralCode(env, email); } catch (e) { /* non-fatal */ }
    }

    await sendEmail(env, email, kind, ref, bytes, bundleKey, myCode);
    // Black-box the delivery to R2 (same pattern as feed-send-log.json): when a
    // subscriber says "I never got my emails", this is the only place that
    // records the signup-bundle attempt. A Resend rejection throws before this
    // line -> 500 -> Stripe retries, so a logged entry means Resend ACCEPTED
    // the mail — anything missing after that is filtering on the receiving end.
    try {
      const lo = await env.BUNDLES.get("delivery-log.json");
      const log = lo ? JSON.parse(await lo.text()) : [];
      log.unshift({ at: new Date().toISOString(), to: email, kind, bundle: bundleKey });
      await env.BUNDLES.put("delivery-log.json", JSON.stringify(log.slice(0, 50)));
    } catch (_) { /* logging must never fail the delivery */ }
    // add new SUBSCRIBERS (not one-time pack buyers) to the weekly-feed list in R2
    if (kind === "monthly" && ((event.data && event.data.object) || {}).mode === "subscription") {
      await addSubscriber(env, email, event);
    }
    // if this buyer arrived via someone's referral link, credit the referrer
    if (kind === "monthly" && ref && ref.startsWith("ref-")) {
      try { await creditReferrer(env, ref.slice(4), email); } catch (e) { /* non-fatal */ }
    }
    return json({ ok: true, delivered: kind, to: email, bundle: bundleKey });
  } catch (e) {
    return json({ ok: false, error: String(e && e.message || e) }, 500);
  }
}

// This Stripe account is SHARED with another product (IRWatch, ~$4.35/mo). Its
// invoice.paid / checkout.session.completed events hit THIS endpoint too, so
// without a filter we email MassPermits data to IRWatch customers. MassPermits'
// CHEAPEST real charge is the FIRST90 promo (90% off $99 = $9.90 = 990¢); its
// regular tiers are $49 (pack) / $99 (weekly feed). IRWatch bills $4.35 (435¢).
// The floor must sit BETWEEN those two, so $5.00 separates them cleanly while
// letting the $9.90 promo through — the old $10 floor silently dropped every
// FIRST90 sale (customer charged, no bundle delivered). Follow-up: swap to an
// explicit MassPermits price-ID allowlist to also cover a hypothetical IRWatch
// annual plan (12×$4.35=$52.20 would clear this floor).
const MIN_CENTS = 500;

// Decide which bundle (if any) to send for this event.
function decideDelivery(event) {
  const o = event.data && event.data.object || {};
  if (event.type === "checkout.session.completed") {
    // $0 + subscription = a FREE-TRIAL start (Farm Town Permit Radar's 7-day
    // trial). IRWatch has no trials and bills $4.35 (never $0), so this stays
    // cleanly separated from the shared-account floor below. If IRWatch ever
    // adds $0 trials, switch to a price-ID allowlist.
    const isTrialStart = o.mode === "subscription" && (o.amount_total || 0) === 0;
    if ((o.amount_total || 0) < MIN_CENTS && !isTrialStart) return null; // not a MassPermits product
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
        customer: o.customer || "", // Stripe customer id — used to match cancellations
        since: new Date().toISOString().slice(0, 10),
        active: true,
        // self-serve download token for the /api/my-leads fallback link
        token: crypto.randomUUID().replace(/-/g, ""),
      });
      await env.BUNDLES.put("subscribers.json", JSON.stringify(list));
    }
  } catch (e) {
    /* non-fatal — the bundle was already delivered */
  }
}

// Flip a subscriber to inactive when their Stripe subscription is deleted.
async function deactivateSubscriber(env, customerId) {
  if (!customerId) return 0;
  try {
    const cur = await env.BUNDLES.get("subscribers.json");
    if (!cur) return 0;
    const list = JSON.parse(await cur.text());
    let n = 0;
    for (const s of list) {
      if (s.customer === customerId && s.active !== false) {
        s.active = false;
        s.cancelled = new Date().toISOString().slice(0, 10);
        n++;
      }
    }
    if (n) await env.BUNDLES.put("subscribers.json", JSON.stringify(list));
    return n;
  } catch (e) {
    return 0;
  }
}

// ── Referral loop ("give a month, get a month") ──────────────────────────────
// Codes live at referral/codes/<code>; credits at referral/credits/<ts>-<code>.
// Payout stays owner-confirmed: a credit fires an email to the owner with the
// exact Stripe action to take — no automatic money movement.
async function mintReferralCode(env, email) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email.toLowerCase()));
  const code = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 10);
  await env.BUNDLES.put("referral/codes/" + code, JSON.stringify({
    email, ts: new Date().toISOString() }), {
    httpMetadata: { contentType: "application/json" } });
  return code;
}

async function creditReferrer(env, code, buyerEmail) {
  if (!/^[a-z0-9]{4,24}$/.test(code)) return;
  const obj = await env.BUNDLES.get("referral/codes/" + code);
  if (!obj) return;
  const { email: referrer } = JSON.parse(await obj.text());
  if (!referrer || referrer.toLowerCase() === (buyerEmail || "").toLowerCase()) return; // no self-referrals
  const ts = new Date().toISOString();
  await env.BUNDLES.put(`referral/credits/${Date.now()}-${code}`, JSON.stringify({
    code, referrer, buyer: buyerEmail, ts }), {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { referrer, ts } });
  // notify the owner with the exact action (credit = -$99 one-time on referrer's sub)
  const owner = env.OWNER_EMAIL || "patrick@masspermits.com";
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.FROM_EMAIL, to: [owner],
      subject: `💸 Referral landed: ${referrer} referred ${buyerEmail}`,
      html: `<div style="font-family:sans-serif"><p><b>${escapeHtml(referrer)}</b> referred
      <b>${escapeHtml(buyerEmail)}</b> (code ${escapeHtml(code)}).</p>
      <p>To honor "give a month, get a month": Stripe → Customers → ${escapeHtml(referrer)} →
      their subscription → add a one-time <b>-$99 credit</b> (or a 100%-off-one-month coupon).</p>
      <p>Logged in R2 at referral/credits/.</p></div>` }),
  }).catch(() => {});
}

async function sendEmail(env, to, kind, ref, bytes, filename, myCode) {
  const human = kind === "weekly" ? "this week's fresh" : "your";
  const isRefCode = ref && ref.startsWith("ref-");
  const refLine = (ref && !isRefCode) ? `<p style="color:#667">Your selection: <b>${escapeHtml(ref.replace(/__/g," · "))}</b></p>` : "";
  const shareBlock = myCode ? `
      <div style="background:#f2fbf8;border:1px solid #b9e8dc;border-radius:10px;padding:14px 16px;margin:18px 0">
        <p style="margin:0 0 6px;font-weight:700;color:#0e7c6b">Give a month, get a month 🤝</p>
        <p style="margin:0;font-size:14px;color:#334">Know another contractor who'd use these leads?
        Send them your link — when they subscribe, you both get a month of the weekly feed free:</p>
        <p style="margin:8px 0 0"><a href="https://masspermits.com/r/${myCode}"
          style="color:#0e7c6b;font-weight:700">masspermits.com/r/${myCode}</a></p>
      </div>` : "";
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0e1622">
      <h2 style="color:#0e7c6b">Your MassPermits leads are attached 📋</h2>
      <p>Thanks for your order. Attached is ${human} building-permit lead bundle.</p>
      ${refLine}
      <p><b>Open <code>MassPermits-Leads.html</code></b> in any browser — it's a full interactive dashboard: live charts, search &amp; filter by trade &amp; town, sort by project value, look up any contractor's active jobs, and click any permit for the complete record. The CSVs are included too (one master + one per trade).</p>
      ${shareBlock}
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

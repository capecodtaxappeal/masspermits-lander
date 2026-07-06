// MassPermits — referral link: masspermits.com/r/<code>
//
// Each paying customer gets a code ("give a month, get a month"). Visiting the
// link drops a 30-day cookie + lands on the homepage; the page script decorates
// the Stripe buy links with client_reference_id=ref-<code>, and the Stripe
// webhook credits the referrer when a referred checkout completes. The beacon
// logs the visit with source=referral so /ops shows referral traffic.

export async function onRequestGet(context) {
  const code = String(context.params.code || "").toLowerCase();
  if (!/^[a-z0-9]{4,24}$/.test(code)) {
    return Response.redirect("https://masspermits.com/", 302);
  }
  const headers = new Headers({
    Location: "https://masspermits.com/?utm_source=referral",
    "Set-Cookie": `mp_ref=ref-${code}; Path=/; Max-Age=2592000; SameSite=Lax; Secure`,
    "Cache-Control": "no-store",
  });
  return new Response(null, { status: 302, headers });
}

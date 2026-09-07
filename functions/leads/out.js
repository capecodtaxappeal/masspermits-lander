// MassPermits — portal sign-out.  KB/07 §2.3: GET /leads/out clears the cookie
// and 302s to /. Auth: any — signing out must never require being signed in.
//
// WHY THIS IS A SECOND FILE. KB/07 §2.3 says "one Pages Function file,
// functions/leads.js, handles the first three by path". Pages file-based
// routing does not work that way: functions/leads.js is matched for /leads
// EXACTLY, so /leads/out would fall through to the static tree and 404. The
// route needs its own file. It is deliberately self-contained (no import from
// ../leads.js) so a bug in the portal can never make sign-out unreachable.
//
// The cookie's Path is /leads, so the clearing Set-Cookie must repeat that Path
// verbatim or the browser deletes nothing and the customer stays signed in
// while being told they are not.

export async function onRequestGet() {
  return new Response(null, {
    status: 302,
    headers: {
      Location: "https://masspermits.com/",
      "Set-Cookie": "mp_sess=; HttpOnly; Secure; SameSite=Lax; Path=/leads; Max-Age=0",
      "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "private, no-store",
      "Vary": "Cookie",
    },
  });
}

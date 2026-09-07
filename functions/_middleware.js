// MassPermits — hostname pin for the internal admin surface.
//
// WHY THIS FILE EXISTS AT ALL, GIVEN CLOUDFLARE ACCESS IS THE GATE
// ----------------------------------------------------------------
// Every Pages deployment keeps a permanent, immutable <hash>.pages.dev URL that
// serves the IDENTICAL Functions against the IDENTICAL BUNDLES binding. A
// zone-level Access application on masspermits.com does not touch those twins.
// So without this file, /admin/pipeline and /api/pipeline are reachable
// unauthenticated on masspermits-lander.pages.dev forever. This is not defence
// in depth; it is the other half of the door.
//
// WHAT THIS FILE MAY DO, AND NOTHING ELSE
// ---------------------------------------
// Pages middleware at functions/_middleware.js runs on EVERY request, including
// /api/stripe-webhook and /api/weekly-send — the paying-customer path. A
// middleware that can throw on the Stripe webhook path is a direct hit on the
// invariant that says never break that path. So the only thing this file does
// is 404 two path prefixes off non-canonical hostnames, the whole check is
// wrapped in a try, and every other outcome — including any error — falls
// through to next(). It reads no R2 object, awaits no network, and has no
// dependency to break.
//
// SHARED OWNERSHIP: two _middleware.js files cannot coexist at this directory
// level. The /leads customer-portal design wants a hostname pin too. If that
// ships, it adds its prefix to GUARDED below rather than adding a second file.
//
// 2026-09-06, /leads shipped (KB/07 Stage D). It did not add to GUARDED,
// because its pin is one notch tighter — apex only, no www — so it has its own
// list, APEX_ONLY, checked first. Nothing about the /admin behaviour changed.

const CANONICAL = "masspermits.com";

// Prefix match, so /api/pipeline also covers /api/pipeline-probe, and /admin
// covers /admin/pipeline (Pages strips .html, so admin/pipeline.html is served
// at /admin/pipeline). Deliberately NOT a list of exact paths: a route added
// under either prefix later is covered by default rather than by memory.
const GUARDED = ["/admin", "/api/pipeline"];

// APEX ONLY — the customer-portal routes (KB/07 §3 A3). Same idea as GUARDED,
// one notch tighter: these 404 on www as well, because every link that reaches
// them is minted by us (weekly-send.js, stripe-webhook.js) and every one of
// those is the apex. A www request to /leads is not a customer following our
// link. Exact-or-child match, never a bare prefix: the site's root SEO pages
// are named like /roofing-leads-greater-boston and must not be caught.
const APEX_ONLY = ["/leads", "/api/my-leads"];

export async function onRequest(context) {
  try {
    const url = new URL(context.request.url);
    const host = url.hostname.toLowerCase();
    const p = url.pathname.toLowerCase().replace(/\/+$/, "") || "/";
    if (host !== CANONICAL && APEX_ONLY.some((g) => p === g || p.startsWith(g + "/"))) {
      return new Response("Not found", {
        status: 404,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "private, no-store",
          "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
        },
      });
    }
    if (host !== CANONICAL && host !== "www." + CANONICAL) {
      const path = url.pathname.toLowerCase();
      if (GUARDED.some((g) => path === g || path.startsWith(g))) {
        // 404, not 403: on a hostname that should not be serving this surface
        // at all, the honest answer is that it does not exist here. A 403
        // confirms the path is real to anything scanning the pages.dev twin.
        return new Response("Not found", {
          status: 404,
          headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
        });
      }
    }
  } catch (_) {
    // Never let the admin gate be the reason a Stripe webhook or a weekly send
    // fails. If the check itself is broken, fall through — the Access
    // application and the JWT verification in /api/pipeline are still in front
    // of every byte of data.
  }
  return context.next();
}

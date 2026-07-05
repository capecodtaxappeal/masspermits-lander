// MassPermits — Cloudflare edge analytics for /ops (ALL requests, incl. bots).
//
// Queries Cloudflare's GraphQL Analytics API with a READ-ONLY token, so /ops can
// show the raw edge totals + unique visitors you'd otherwise open the Cloudflare
// dashboard for — right next to our first-party (humans-only) beacon.
//
// DORMANT until CF_ANALYTICS_TOKEN is set in the Pages project env. Token needs:
//   Zone > Analytics > Read  +  Zone > Zone > Read  (scoped to masspermits.com).
// Optionally set CF_ZONE_ID to skip the zone lookup.

const ZONE_NAME = "masspermits.com";

// Resolve an env var tolerant of stray whitespace in the KEY name (a common
// dashboard copy-paste artifact, e.g. "CF_ANALYTICS_TOKEN "), and trim the value.
function pickEnv(env, name) {
  let v = env[name];
  if (v == null) {
    const k = Object.keys(env).find((k) => k.trim() === name);
    if (k) v = env[k];
  }
  return typeof v === "string" ? v.trim() : v;
}

export async function onRequestGet(context) {
  const { env } = context;
  const token = pickEnv(env, "CF_ANALYTICS_TOKEN");
  if (!token) return json({ ok: false, configured: false });

  const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  try {
    let zoneId = pickEnv(env, "CF_ZONE_ID");
    if (!zoneId) {
      const zr = await fetch(`https://api.cloudflare.com/client/v4/zones?name=${ZONE_NAME}`, { headers });
      const zd = await zr.json();
      zoneId = zd && zd.result && zd.result[0] && zd.result[0].id;
      if (!zoneId) {
        return json({ ok: false, configured: true,
          error: "couldn't resolve zone — add Zone:Read to the token, or set CF_ZONE_ID" });
      }
    }
    const until = new Date().toISOString().slice(0, 10);
    const since = new Date(Date.now() - 6 * 86400_000).toISOString().slice(0, 10);
    const query = `{viewer{zones(filter:{zoneTag:"${zoneId}"}){httpRequests1dGroups(` +
      `limit:7,filter:{date_geq:"${since}",date_leq:"${until}"},orderBy:[date_ASC])` +
      `{dimensions{date} sum{requests pageViews} uniq{uniques}}}}}`;
    const gr = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST", headers, body: JSON.stringify({ query }),
    });
    const gd = await gr.json();
    if (gd.errors && gd.errors.length) {
      return json({ ok: false, configured: true, error: String(gd.errors[0].message || "graphql error").slice(0, 180) });
    }
    const groups = (((gd.data || {}).viewer || {}).zones || [])[0];
    const rows = (groups && groups.httpRequests1dGroups) || [];
    const days = rows.map((g) => ({
      date: g.dimensions.date,
      requests: (g.sum && g.sum.requests) || 0,
      pageViews: (g.sum && g.sum.pageViews) || 0,
      uniques: (g.uniq && g.uniq.uniques) || 0,
    }));
    return json({ ok: true, configured: true, days });
  } catch (e) {
    return json({ ok: false, configured: true, error: String(e && e.message || e).slice(0, 180) });
  }
}

function json(obj) {
  return new Response(JSON.stringify(obj), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

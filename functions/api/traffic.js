// MassPermits — traffic aggregate for /ops (public, counts only, no PII).
// Rolls up the last 7 days of first-party beacon hits (functions/api/hit.js)
// straight from R2 list()+customMetadata — no per-hit body reads.

export async function onRequestGet(context) {
  const { env } = context;
  const now = Date.now();
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(new Date(now - i * 86400_000).toISOString().slice(0, 10));

  const out = [];
  for (const day of days) {
    let cursor, total = 0;
    const sources = {}, paths = {};
    do {
      const list = await env.BUNDLES.list({
        prefix: `hits/${day}/`, limit: 1000, cursor, include: ["customMetadata"],
      });
      for (const o of list.objects) {
        total++;
        const m = o.customMetadata || {};
        const s = m.s || "direct";
        sources[s] = (sources[s] || 0) + 1;
        const p = m.p || "/";
        paths[p] = (paths[p] || 0) + 1;
      }
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);
    out.push({ day, total, sources, paths });
  }
  return new Response(JSON.stringify({ days: out }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

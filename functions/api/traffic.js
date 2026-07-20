// MassPermits — traffic aggregate for /ops (public, counts only, no PII).
// Rolls up the last 7 days of first-party beacon hits (functions/api/hit.js)
// straight from R2 list()+customMetadata — no per-hit body reads.

export async function onRequestGet(context) {
  const { env } = context;
  const now = Date.now();
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(new Date(now - i * 86400_000).toISOString().slice(0, 10));

  const out = [];
  const langAll = {};   // 7-day browser-language rollup (ICP language signal)
  for (const day of days) {
    let cursor, total = 0;
    const sources = {}, paths = {}, langs = {};
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
        if (m.lang) {
          langs[m.lang] = (langs[m.lang] || 0) + 1;
          langAll[m.lang] = (langAll[m.lang] || 0) + 1;
        }
      }
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);
    out.push({ day, total, sources, paths, langs });
  }
  // Share of visitors whose browser primary language is Portuguese — the single
  // number that confirms or kills the Brazilian-tradesman ICP hypothesis.
  const langTotal = Object.values(langAll).reduce((a, b) => a + b, 0);
  const pt = Object.entries(langAll).filter(([k]) => k.startsWith("pt")).reduce((a, [, v]) => a + v, 0);
  const langSignal = { total_with_lang: langTotal, portuguese: pt,
    pt_share: langTotal ? +(pt / langTotal).toFixed(3) : 0, by_lang: langAll };
  return new Response(JSON.stringify({ days: out, langSignal }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// MassPermits — cold-outreach status (read-only, PUBLIC but harmless).
//
// Returns COUNTS ONLY (never recipient addresses) so the owner can eyeball
// progress from a browser: sent today, total sent, queue remaining, paused?,
// last few sends' timestamps + status. No auth needed — it exposes no PII.
//
// (Pause/resume + suppression edits are done via wrangler on cold-state.json /
// suppression.json, or just ask Claude in-session — kept off any public write
// path so the outreach cadence can't be tampered with from the internet.)

export async function onRequestGet(context) {
  const { env } = context;
  try {
    const s = await env.BUNDLES.get("cold-state.json");
    const q = await env.BUNDLES.get("cold-queue.json");
    const state = s ? JSON.parse(await s.text()) : {};
    const queue = q ? JSON.parse(await q.text()) : [];
    const log = state.log || [];
    const sentAddrs = new Set(log.map((e) => (e.to || "").toLowerCase()));
    const today = new Date().toISOString().slice(0, 10);
    return json({
      paused: !!state.paused,
      ramp_start: state.ramp_start || null,
      sent_today: (state.sent_by_day || {})[today] || 0,
      sent_total: log.filter((e) => e.status === "sent").length,
      refused_total: log.filter((e) => e.status === "refused").length,
      queue_total: queue.length,
      queue_remaining: queue.filter((e) => !sentAddrs.has((e.to || "").toLowerCase())).length,
      recent: log.slice(-5).map((e) => ({ ts: e.ts, batch: e.batch, status: e.status })), // no addresses
    });
  } catch (e) {
    return json({ error: String(e && e.message || e).slice(0, 160) }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

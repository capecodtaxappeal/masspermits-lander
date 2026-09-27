// Road to 100: the page. Renders from a real route answer into the fake DOM
// (which throws on innerHTML, style attributes and inline handlers), works in
// plain words, and leaves Mission Control's files untouched.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as H from "./_harness.mjs";

const { g, stub, call, envOf } = await H.growthSetup();
const NOW = H.T("2026-09-27T18:00:00Z");
const read = (p) => fs.readFileSync(path.join(H.REPO, p), "utf8");
const EM = String.fromCharCode(0x2014), EN = String.fromCharCode(0x2013);
const DASH = new RegExp("[" + EM + EN + "]|&[mn]dash;|&#0*821[12];|&#[xX]0*201[34];|\\\\u201[34]", "i");

function mount() {
  const doc = H.fakeDocumentFrom('<div id="app"></div>');
  return { doc, root: doc.getElementById("app") };
}
const texts = (root) => { const out = []; root.walk((n) => { if (n.tagName === "#text") out.push(n._text); }); return out; };

async function answer(stripeData, env = H.stripeEnv(), o = {}) {
  const r2 = new H.GrowthR2();
  r2.hit(H.T("2026-07-05T15:00:00Z"));
  for (let i = 0; i < 25; i++) r2.hit(NOW - 2 * H.DAY + i);
  r2.click(NOW - 2 * H.DAY);
  g.stripe.resetGrowthCaches();
  stub.stripe = H.stripeServer(stripeData, o);
  return call({ env: envOf(r2, env), now: NOW });
}

test("a good answer renders the headline, the goal line, both funnels and 13 weeks, newest first", async () => {
  const res = await answer({
    sessions: [H.session(NOW - H.DAY, "complete"), H.session(NOW - 2 * H.DAY, "expired")],
    subscriptions: [1, 2, 3, 4, 5].map((i) => H.sub(NOW - (10 + i * 7) * H.DAY, "active")),
  });
  const { root } = mount();
  assert.equal(g.render.render(root, { status: 200, json: res.body }), "ok");
  const all = texts(root).join(" | ");
  const head = root.byPart("headline")[0];
  assert.equal(head.textContent, "5 of 100");
  const chart = root.byPart("chart")[0];
  assert.ok(chart.all((n) => n.localName === "line" && n.getAttribute("class") === "goal").length === 1);
  assert.ok(chart.all((n) => n.localName === "polyline").length === 1);
  const rows = root.byPart("weeks")[0].all((n) => n.localName === "tr");
  assert.equal(rows.length, 14);
  assert.equal(rows[1].children[0].textContent, "This week");
  assert.equal(rows[13].children[0].textContent, "Jun 29");
  assert.ok(all.includes("This week so far"));
  assert.ok(all.includes("Abandoned"));
  assert.ok(all.includes("1 of 2 checkouts"));
  assert.ok(!DASH.test(all), "a dash in the rendered page");
});

test("Stripe unavailable renders \"unavailable\", never 0, in the headline and every Stripe cell", async () => {
  const res = await answer({ sessions: [], subscriptions: [] }, H.stripeEnv(), { fail: () => true });
  const { root } = mount();
  g.render.render(root, { status: 200, json: res.body });
  assert.equal(root.byPart("headline")[0].textContent, "unavailable");
  const rows = root.byPart("weeks")[0].all((n) => n.localName === "tr").slice(1);
  for (const r of rows) {
    const cells = r.children.map((c) => c.textContent);
    for (const i of [3, 4, 5, 6]) assert.equal(cells[i], "unavailable", "column " + i + " " + cells.join(","));
  }
});

test("errors render plain words; nothing from the response becomes markup", () => {
  for (const [res, words] of [[{ status: 0, json: null }, "Could not reach"], [{ status: 403, json: { reason: "not-owner" } }, "only for the owner"],
    [{ status: 503, json: { error: "unavailable" } }, "unavailable right now"], [{ status: 200, json: { weeks: "<img src=x onerror=alert(1)>" } }, "unavailable"]]) {
    const { root } = mount();
    assert.equal(g.render.render(root, res), "error");
    assert.ok(root.byPart("error")[0].textContent.includes(words), words);
  }
});

test("page files: phone viewport, no inline script or style, CSP header, no dash anywhere a person reads", () => {
  const html = read("admin/growth.html");
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
  assert.ok(!/<script>(?!<\/script>)|<script(?![^>]*\bsrc=)[^>]*>|<style|\sstyle=|\son[a-z]+=/i.test(html));
  const headers = read("_headers");
  assert.ok(headers.includes("/admin/growth\n  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self';"));
  for (const f of ["admin/growth.html", "admin/growth.css", "admin/growth-render.js", "admin/growth-app.js", "js/buy-click.js",
    "functions/admin/api/growth.js", "functions/api/_growth_data.js", "functions/api/_growth_stripe.js", "docs/growth/README.md"]) {
    assert.ok(!DASH.test(read(f)), f + " has an em or en dash");
  }
  for (const f of ["admin/growth-render.js", "admin/growth-app.js"]) {
    const src = read(f);
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|localStorage|sessionStorage|\beval\(/.test(src), f);
  }
  // the one request the page makes, and its header
  const app = read("admin/growth-app.js");
  assert.equal((app.match(/fetch\(/g) || []).length, 1);
  assert.ok(app.includes('"/admin/api/growth"') && app.includes('"X-MassPermits-Growth": "1"'));
});

test("Mission Control's page files are untouched (their byte budget stands)", () => {
  let base = null;
  for (const ref of ["origin/main", "main"]) {
    try { base = execFileSync("git", ["merge-base", ref, "HEAD"], { cwd: H.REPO, encoding: "utf8" }).trim(); break; } catch (_) { /* next */ }
  }
  assert.ok(base);
  const changed = execFileSync("git", ["diff", "--name-only", base, "--", "admin/mission.html", "admin/mission-app.js",
    "admin/mission-render.js", "admin/mission-view.js", "admin/mission-app.css", "functions/admin/api/mission.js",
    "functions/api/_mission_stripe.js", "functions/api/_mission_r2.js", "functions/api/_owner_gate.js"], { cwd: H.REPO, encoding: "utf8" }).trim();
  assert.equal(changed, "");
});

// P2-2, P2-3, P2-5, P2-7, P2-11, P2-12: the static page files.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as H from "./_harness.mjs";

const read = (p) => fs.readFileSync(path.join(H.REPO, p), "utf8");
const git = (...a) => execFileSync("git", a, { cwd: H.REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const PAGE = ["admin/mission.html", "admin/mission-app.js", "admin/mission-render.js", "admin/mission-view.js", "admin/mission-app.css"];
const ALL = [...PAGE, "admin/mission-towns.json"];
const BASE = "origin/claude/mission-control";

test("P2-2 admin/mission-towns.json is the seed geometry byte for byte: SHA-256 and 351 towns", () => {
  const buf = fs.readFileSync(path.join(H.REPO, "admin/mission-towns.json"));
  assert.equal(createHash("sha256").update(buf).digest("hex"), "e8df13d21be725a5fb3403815da92970d3ab737770cbbcc423ee1cf4fdb9f303");
  assert.equal(buf.length, 61330);
  const geo = JSON.parse(buf.toString("utf8"));
  assert.equal(Object.keys(geo.towns).length, 351);
  assert.equal(geo.attribution, "Boundaries: U.S. Census Bureau, TIGER/Line Shapefiles 2024");
});

test("P2-3 no HTML sink and no storage API in any admin/mission* file", () => {
  const files = fs.readdirSync(path.join(H.REPO, "admin")).filter((f) => f.startsWith("mission")).map((f) => "admin/" + f);
  assert.deepEqual(files.sort(), ALL.slice().sort(), "only the allowed page files exist");
  for (const f of files) {
    const src = read(f);
    for (const re of [/innerHTML/, /insertAdjacentHTML/, /outerHTML/, /document\.write/, /eval\(/, /new Function/,
      /setAttribute\(\s*["']style/, /setAttribute\(\s*["']on/, /localStorage/, /sessionStorage/, /indexedDB/,
      /caches\./, /serviceWorker/, /document\.cookie/]) {
      assert.ok(!re.test(src), f + " contains " + re);
    }
  }
});

test("P2-3 mission.html: no inline script body, no style=, no remote script, robots meta, one module, one stylesheet", () => {
  const html = read("admin/mission.html");
  for (const s of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) assert.equal(s[2].trim(), "", "inline script body");
  const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)].map((x) => x[1]);
  assert.deepEqual(scripts, [' type="module" src="/admin/mission-app.js"']);
  const sheets = [...html.matchAll(/<link\b([^>]*)>/gi)].map((x) => x[1]);
  assert.deepEqual(sheets, [' rel="stylesheet" href="/admin/mission-app.css"']);
  assert.ok(!/\sstyle\s*=/i.test(html));
  assert.ok(!/<script[^>]+src="https?:/i.test(html));
  assert.ok(!/<style\b/i.test(html));
  assert.ok(!/\/api\/hit|beacon|font/i.test(html));
  assert.ok(html.includes('<meta name="robots" content="noindex,nofollow">'));
  assert.ok(html.includes('<meta name="viewport"'));
  assert.ok(/<section id="setup-needed"[^>]*hidden/.test(html), "static Setup needed block, hidden until the API says not-configured");
  assert.ok(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(html), "no address in the setup block");
});

test("P2-3 the attribution string is on the page", () => {
  assert.ok(read("admin/mission-view.js").includes('"Boundaries: U.S. Census Bureau, TIGER/Line Shapefiles 2024"'));
  assert.ok(read("admin/mission-render.js").includes("TEXT.attribution"));
});

test("P2-3 only mission-app.js makes a request", () => {
  for (const f of ["admin/mission-render.js", "admin/mission-view.js"]) {
    const src = read(f);
    for (const re of [/fetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /EventSource/, /sendBeacon/, /import\s*\(/,
      /setTimeout|setInterval|requestAnimationFrame/]) assert.ok(!re.test(src), f + " " + re);
  }
  assert.doesNotMatch(read("admin/mission-view.js"), /\bdocument\b|\bwindow\b/, "the view module touches no DOM");
  const app = read("admin/mission-app.js");
  assert.equal((app.match(/(?<![A-Za-z0-9_$.])fetch\s*\(/g) || []).length, 1);
  for (const u of app.matchAll(/"(\/[^"]*)"/g)) {
    assert.ok(["/admin/api/mission", "/admin/api/mission?view=map", "/admin/mission-towns.json",
      "/admin/api/mission-outreach"].includes(u[1]), "request path " + u[1]);
  }
  assert.ok(app.includes('credentials: "same-origin"'));
  assert.ok(app.includes('"X-MassPermits-Mission": "1"'));
  assert.ok(!/https?:/.test(app));
});

test("P2-5 _headers gains exactly the /admin/mission block, outside the widget block", () => {
  const before = git("show", BASE + ":_headers");
  const now = read("_headers");
  const block = [
    "/admin/mission",
    "  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    "  X-Frame-Options: DENY",
    "  X-Robots-Tag: noindex, nofollow, noarchive, nosnippet",
    "  Referrer-Policy: no-referrer",
    "  Cache-Control: private, no-store",
  ].join("\n");
  assert.equal(now, before + "\n" + block + "\n");
  assert.ok(now.indexOf("# <<< widget tier") < now.indexOf("/admin/mission"));
  assert.equal(now.split("/admin/mission").length, 2);
});

test("P2-7 page weight <= 45 KB", () => {
  const sizes = Object.fromEntries(PAGE.map((f) => [f, fs.statSync(path.join(H.REPO, f)).size]));
  const total = Object.values(sizes).reduce((a, b) => a + b, 0);
  console.log("page weight", JSON.stringify(sizes), "total", total);
  assert.ok(total <= 45 * 1024, "page files are " + total + " bytes");
});

// ── P2-11 contrast, from the CSS tokens ─────────────────────────────────────
function tokens(css) {
  const block = (re) => {
    const mm = css.match(re);
    assert.ok(mm, "token block " + re);
    return Object.fromEntries([...mm[1].matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map((x) => [x[1], x[2].toLowerCase()]));
  };
  const light = block(/^:root \{([^}]*)\}/m);
  const media = block(/@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{([^}]*)\}/);
  const dark = block(/^:root\[data-theme="dark"\] \{([^}]*)\}/m);
  return { light, media, dark };
}
function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test("P2-11 contrast: text >= 4.5:1 and state marks >= 3:1 on every surface, light and dark", () => {
  const t = tokens(read("admin/mission-app.css"));
  assert.deepEqual(t.media, t.dark, "the dark tokens are the same under the media query and data-theme");
  const TEXT = ["ink", "muted", "accent", "ok", "watch", "act", "grey"];
  const MARKS = ["ok", "watch", "act", "grey"];
  const SURF = ["paper", "box"];
  const report = [];
  for (const [theme, tk] of [["light", t.light], ["dark", t.dark]]) {
    for (const s of SURF) {
      for (const x of TEXT) {
        const r = ratio(tk[x], tk[s]);
        report.push(theme + " " + x + " on " + s + " " + r.toFixed(2));
        assert.ok(r >= 4.5, theme + " text " + x + " on " + s + " is " + r.toFixed(2));
      }
      for (const x of MARKS) assert.ok(ratio(tk[x], tk[s]) >= 3, theme + " mark " + x + " on " + s);
    }
    // the ink rules that frame the boxes, and the paper-coloured map strokes against the none fill
    assert.ok(ratio(tk.rule, tk.paper) >= 3, theme + " rule on paper");
    report.push(theme + " rule on paper " + ratio(tk.rule, tk.paper).toFixed(2));
  }
  console.log("contrast", report.join("; "));
});

test("P2-11 system fonts only: no font file, no @font-face, no @import, no url(", () => {
  const css = read("admin/mission-app.css");
  assert.ok(!/@font-face|@import|url\(/i.test(css));
  assert.ok(css.includes("ui-serif, Georgia"), "the serif system stack of direction C");
});

test("P2-12 branch hygiene: only P2 files, test/mission/ files and the demo differ from claude/mission-control", () => {
  let base;
  try { base = git("merge-base", BASE, "HEAD").trim(); } catch (_) { base = null; }
  assert.ok(base, "no " + BASE + " ref to compare against");
  const tracked = git("diff", "--name-only", base).split("\n").filter(Boolean);
  const untracked = git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean);
  const changed = [...new Set([...tracked, ...untracked])].sort();
  const ok = (p) => ALL.includes(p) || p === "_headers" || p === "functions/admin/api/mission-outreach.js" ||
    p === "docs/mission/demo.html" || /^test\/mission\/[A-Za-z0-9_-]+\.(test\.)?mjs$/.test(p);
  assert.deepEqual(changed.filter((p) => !ok(p)), []);
  for (const p1 of ["functions/api/_owner_gate.js", "functions/api/_mission_r2.js", "functions/api/_mission_stripe.js",
    "functions/api/_mission_data.js", "functions/admin/api/mission.js"]) assert.ok(!changed.includes(p1), p1 + " changed");
  assert.deepEqual(changed.filter((p) => p.startsWith("docs/")), ["docs/mission/demo.html"]);
});

// "Check your towns" in a real browser: layout and wiring.
//
// What this file proves, on the shipped index.html served from this checkout:
//  * at 375 px and 1280 px wide there is no sideways scrolling, before and
//    after towns are checked and added as chips;
//  * an alias typed in the box resolves ("foxboro" shows as Foxborough);
//  * "Get a free sample for these towns" fills the sample form's chips;
//  * the towns and role ride only on /api/request-sample, not on Web3Forms;
//  * if coverage.json fails to load, the box stays hidden.
//
// Needs Playwright and a Chromium. Where neither is installed (CI) every test
// here is skipped. Every request off this machine is blocked: /api/* and
// Web3Forms are answered by stubs, so nothing is stored and no mail goes out.
//
//   node --test test/town-check-layout.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AT = String.fromCharCode(64);

async function findPlaywright() {
  try { return await import("playwright"); } catch {}
  for (const dir of ["/opt/node22/lib/node_modules", "/usr/local/lib/node_modules", "/usr/lib/node_modules"]) {
    try { return createRequire(path.join(dir, "x.js"))("playwright"); } catch {}
  }
  return null;
}
const pw = await findPlaywright();
let browser = null;
if (pw) { try { browser = await pw.chromium.launch(); } catch { browser = null; } }
const skip = browser ? false : "Playwright or Chromium not available";

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css",
  ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".xml": "application/xml" };
let server = null, base = "";
if (browser) {
  server = http.createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.join(REPO, path.normalize(rel));
    if (!file.startsWith(REPO + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
}
test.after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((r) => server.close(r));
});

async function open(width, { failCoverage = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const posts = [];
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.origin === base) {
      if (u.pathname.startsWith("/api/")) {
        if (u.pathname === "/api/request-sample") posts.push({ to: "request-sample", body: route.request().postData() });
        return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
      }
      if (failCoverage && u.pathname === "/research/evidence/coverage.json") return route.fulfill({ status: 500, body: "" });
      return route.continue();
    }
    if (u.hostname === "api.web3forms.com") {
      posts.push({ to: "web3forms", body: route.request().postData() });
      return route.fulfill({ status: 200, contentType: "application/json", body: '{"success":true}',
        headers: { "access-control-allow-origin": "*" } });
    }
    return route.abort();
  });
  await page.goto(base + "/index.html", { waitUntil: "load" });
  return { page, posts };
}
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const width of [375, 1280]) {
  test("layout at " + width + " px: no sideways scrolling, before and after use", { skip }, async () => {
    const { page } = await open(width);
    await page.waitForSelector("#town-check:not([hidden])", { timeout: 10000 });
    await page.waitForSelector("#sx:not([hidden])");
    assert.ok(await sideways(page) <= 0, "before use");
    for (const t of ["Manchester by the Sea", "North Attleborough", "foxboro", "Gosnold", "Worcester"]) {
      await page.fill("#tc-input", t);
      await page.press("#tc-input", "Enter");
    }
    await page.click("#tc-results li:first-child .tc-go");
    assert.ok(await sideways(page) <= 0, "after use");
    await page.close();
  });
}

test("browser: aliases resolve, the sample button fills the chips, extras go only to request-sample", { skip }, async () => {
  const { page, posts } = await open(375);
  await page.waitForSelector("#town-check:not([hidden])", { timeout: 10000 });
  await page.fill("#tc-input", "foxboro");
  await page.press("#tc-input", "Enter");
  await page.fill("#tc-input", "Nowhereville");
  await page.press("#tc-input", "Enter");
  assert.match(await page.textContent("#tc-msg"), /No Massachusetts town/);
  await page.fill("#tc-input", "salem");
  await page.press("#tc-input", "Enter");
  const names = await page.$$eval("#tc-results li b", (bs) => bs.map((b) => b.textContent));
  assert.deepEqual(names, ["Salem", "Foxborough"]);
  const labels = await page.$$eval("#tc-results .tc-status", (s) => s.map((x) => x.textContent));
  for (const l of labels) assert.match(l, /^(In the weekly file|Arrives monthly, newest permit \d{4}-\d{2}-\d{2}|Paused(, newest permit \d{4}-\d{2}-\d{2})?|Not covered yet)$/);

  await page.click("#tc-results li:last-child .tc-go");
  assert.deepEqual(await page.$$eval("#sx-chips .sx-chip", (c) => c.map((x) => x.getAttribute("aria-label"))),
    ["Remove Salem", "Remove Foxborough"]);
  await page.fill("#sx-town", "Boxboro");
  await page.press("#sx-town", "Enter");
  await page.selectOption("#sx-role", "Supplier or distributor");
  await page.fill("#email", "sample.reader" + AT + "example.com");
  await page.click("#signup-form button[type=submit]");
  await page.waitForSelector("#signup-ok", { state: "visible" });

  const rs = posts.filter((p) => p.to === "request-sample").map((p) => JSON.parse(p.body));
  assert.equal(rs.length, 1);
  assert.deepEqual(rs[0].towns, ["Salem", "Foxborough", "Boxborough"]);
  assert.equal(rs[0].role, "Supplier or distributor");
  const w3 = posts.filter((p) => p.to === "web3forms").map((p) => JSON.parse(p.body));
  assert.equal(w3.length, 1);
  assert.deepEqual(Object.keys(w3[0]).sort(), ["access_key", "area", "botcheck", "email", "from_name", "subject", "trade"]);
  await page.close();
});

test("browser: the box stays hidden when coverage.json fails to load", { skip }, async () => {
  const { page } = await open(375, { failCoverage: true });
  await page.waitForSelector("#sx:not([hidden])", { timeout: 10000 });
  await page.waitForTimeout(300);
  assert.equal(await page.isVisible("#town-check"), false);
  await page.close();
});

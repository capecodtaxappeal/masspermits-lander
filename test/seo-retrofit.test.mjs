// Tests for scripts/seo/retrofit-titles.mjs on a tiny fixture site.
//
//   node --test test/seo-retrofit.test.mjs
//
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { run, SUFFIX } from "../scripts/seo/retrofit-titles.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/seo/retrofit-titles.mjs", import.meta.url));
const LONG = "Example Town, MA Building Permits and Contractor Activity Report";
const MID = "Example Town, MA Building Permits Weekly Activity Summary"; // 56, over 60 with the suffix
const SHORT = "Short Town Permits";

const page = (title, extra = "") => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>${title}</title>
${extra}<meta property="og:title" content="${title}">
<meta name="description" content="Fixture page ${SUFFIX}">
</head><body><h1>${title}</h1>
<svg><title>chart point ${SUFFIX}</title></svg>
<p>café ${SUFFIX}</p>
</body></html>
`;

const FILES = {
  "permits/frozen-long.html": page(LONG + SUFFIX),                      // priority 0.3
  "news/absent/long.html": page(MID + SUFFIX),                           // not in sitemap
  "permits/frozen-short.html": page(SHORT + SUFFIX),                    // 60 or fewer
  "permits/frozen-nosuffix.html": page(LONG + " Extra Words Here"),     // no suffix
  "permits/generated-long.html": page(LONG + SUFFIX),                   // priority 0.6
  "permits/meta-noindex.html": page(LONG + SUFFIX, '<meta name="robots" content="noindex, follow">\n'),
  "hidden/header-noindex.html": page(LONG + SUFFIX),                    // _headers noindex
  "index.html": page(LONG + SUFFIX),                                    // hand-written
};
const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://example.test/</loc><priority>1.0</priority></url>
<url><loc>https://example.test/permits/frozen-long</loc><priority>0.3</priority></url>
<url><loc>https://example.test/permits/frozen-short</loc><priority>0.3</priority></url>
<url><loc>https://example.test/permits/frozen-nosuffix</loc><priority>0.3</priority></url>
<url><loc>https://example.test/permits/generated-long</loc><priority>0.6</priority></url>
<url><loc>https://example.test/permits/meta-noindex</loc><priority>0.3</priority></url>
</urlset>
`;
const HEADERS = "/hidden/*\n  X-Robots-Tag: noindex\n";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seo-retrofit-"));
  for (const [rel, body] of Object.entries(FILES)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  fs.writeFileSync(path.join(root, "sitemap.xml"), SITEMAP);
  fs.writeFileSync(path.join(root, "_headers"), HEADERS);
  return root;
}

const snapshot = (root) => Object.fromEntries(Object.keys(FILES).map((rel) => [rel, fs.readFileSync(path.join(root, rel))]));

// split a file into [before <title> inner, title inner, after </title>] bytes
function splitTitle(buf) {
  const s = buf.toString("latin1");
  const m = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(s);
  const a = m.index + m[0].indexOf(">") + 1, b = a + m[1].length;
  return [buf.subarray(0, a), buf.subarray(a, b), buf.subarray(b)];
}

test("frozen long titles lose the suffix; everything else is untouched", () => {
  const root = fixture();
  const before = snapshot(root);
  const r = run(root, { apply: true });
  const after = snapshot(root);
  const changed = Object.keys(FILES).filter((k) => !before[k].equals(after[k])).sort();
  assert.deepEqual(changed, ["news/absent/long.html", "permits/frozen-long.html"]);
  assert.equal(r.changed, 2);
  assert.deepEqual(r.byFolder, { news: 1, permits: 1 });
  assert.equal(r.stillOver, 1); // LONG itself is 64 characters, MID is 56
  for (const k of changed) {
    const [a0, t0, z0] = splitTitle(before[k]);
    const [a1, t1, z1] = splitTitle(after[k]);
    assert.ok(a0.equals(a1), `${k}: bytes before <title> changed`);
    assert.ok(z0.equals(z1), `${k}: bytes after </title> changed`);
    const base = k.startsWith("news/") ? MID : LONG;
    assert.equal(t0.toString("utf8"), base + SUFFIX);
    assert.equal(t1.toString("utf8"), base);
    // og:title, h1 and the description keep the suffix
    const html = after[k].toString("utf8");
    assert.ok(html.includes(`<meta property="og:title" content="${base}${SUFFIX}">`));
    assert.ok(html.includes(`<h1>${base}${SUFFIX}</h1>`));
    assert.ok(html.includes(`<title>chart point ${SUFFIX}</title>`));
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test("a second run changes nothing", () => {
  const root = fixture();
  run(root, { apply: true });
  const once = snapshot(root);
  const r2 = run(root, { apply: true });
  assert.equal(r2.changed, 0);
  const twice = snapshot(root);
  for (const k of Object.keys(FILES)) assert.ok(once[k].equals(twice[k]), `${k} changed on the second run`);
  fs.rmSync(root, { recursive: true, force: true });
});

test("--dry-run prints counts and writes nothing", () => {
  const root = fixture();
  const before = snapshot(root);
  const out = execFileSync(process.execPath, [SCRIPT, "--dry-run", "--root", root], { encoding: "utf8" });
  assert.match(out, /that would change: 2/);
  assert.match(out, /still over 60 characters: 1/);
  const after = snapshot(root);
  for (const k of Object.keys(FILES)) assert.ok(before[k].equals(after[k]), `${k} written in dry run`);
  fs.rmSync(root, { recursive: true, force: true });
});

test("the script refuses to run without a mode", () => {
  assert.throws(() => execFileSync(process.execPath, [SCRIPT], { stdio: "pipe" }));
});

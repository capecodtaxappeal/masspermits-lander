// The promo switch (js/promo-switch.js) and the hand-written pages that use it.
//
// 2026-10-04: the homepage said a $49 first month was "Applied automatically", and
// FOUNDER2026 did not apply at checkout in two separate sessions. Every promo line on
// index.html, offer.html and offer/index.html sat in <template data-promo="CODE">
// and shows only while that code is true in js/promo-switch.js. These tests hold in
// BOTH switch states, so turning a code back on stays a one-line edit:
//
//  - each code is a single boolean line, and flipping that line is all it takes;
//  - with every code off, nothing a visitor sees or follows names a promotion;
//  - with a code on, its templates replace their full-price twins and no id repeats.
//
//   node --test test/promo-switch.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SWITCH = fs.readFileSync(path.join(REPO, "js", "promo-switch.js"), "utf8");
const PAGES = ["index.html", "offer.html", "offer/index.html"];
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8");
const TAG = '<script src="/js/promo-switch.js"></script>';
const call = (code) => `<script>window.mpPromo&&mpPromo("${code}")</script>`;

function runSwitch(src, doc) {
  const window = {};
  vm.runInNewContext(src, { window, document: doc, Object });
  return window;
}
const CODES = Object.keys(runSwitch(SWITCH, {}).MP_PROMO_ON);

const noComments = (h) => h.replace(/<!--[\s\S]*?-->/g, "");
const noScripts = (h) => h.replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<style\b[\s\S]*?<\/style>/gi, "");
const visibleText = (h) => noScripts(noComments(h)).replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const ids = (h) => [...noScripts(noComments(h)).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);

test("js/promo-switch.js: each code is one boolean line, and flipping that line is the whole switch", () => {
  assert.deepEqual(CODES.sort(), ["FIRST90", "FOUNDER2026"]);
  for (const code of CODES) {
    const lines = SWITCH.split("\n").filter((l) => new RegExp(`^\\s*${code}: (true|false),?\\s*//`).test(l));
    assert.equal(lines.length, 1, `${code}: exactly one switch line`);
    const was = /: true/.test(lines[0]);
    const flipped = SWITCH.replace(lines[0], lines[0].replace(/: (true|false)/, `: ${!was}`));
    assert.equal(runSwitch(flipped, {}).MP_PROMO_ON[code], !was, `${code}: one edit flips it`);
  }
  assert.ok(!/buy\.stripe\.com|prefilled_promo_code/.test(SWITCH), "no checkout link lives in the switch file");
});

test("mpPromo: OFF leaves the page alone; ON unwraps the templates and removes the full-price twins", () => {
  const done = [];
  const mk = (kind, code) => ({ kind, code, content: { cloneNode: () => ({ from: code }) },
    parentNode: { replaceChild: (n, o) => done.push(["unwrap", o.code]), removeChild: (o) => done.push(["remove", o.code]) } });
  const nodes = [mk("template", "FOUNDER2026"), mk("off", "FOUNDER2026"), mk("template", "FIRST90"), mk("off", "FIRST90")];
  const doc = { querySelectorAll(sel) {
    const t = /^template\[data-promo="(\w+)"\]$/.exec(sel), o = /^\[data-promo-off="(\w+)"\]$/.exec(sel);
    if (t) return nodes.filter((n) => n.kind === "template" && n.code === t[1]);
    if (o) return nodes.filter((n) => n.kind === "off" && n.code === o[1]);
    throw new Error("unexpected selector " + sel);
  } };
  const allOff = SWITCH.replace(/^(\s*[A-Z0-9]+): true/gm, "$1: false");
  const w = runSwitch(allOff, doc);
  for (const c of [...CODES, "NOSUCHCODE", "toString", "__proto__"]) w.mpPromo(c);
  assert.deepEqual(done, [], "every code off: nothing on the page changes");
  const w2 = runSwitch(allOff.replace(/^(\s*FOUNDER2026): false/m, "$1: true"), doc);
  w2.mpPromo("FOUNDER2026");
  w2.mpPromo("FIRST90");
  assert.deepEqual(done, [["unwrap", "FOUNDER2026"], ["remove", "FOUNDER2026"]], "only the code switched on changes");
  const w3 = runSwitch(allOff.replace(/^(\s*FIRST90): false/m, '$1: "yes"'), doc);
  w3.mpPromo("FIRST90");
  assert.equal(done.length, 2, "anything but the literal true counts as off");
});

// 2026-11-02: the promo markup was removed from the pages outright (price is $99 a
// month only), so no edit to the switch can put a promotion back on a page. The
// switch file itself stays, with every code false; the tests above still hold it.
test("no page loads the switch or carries promo markup", () => {
  for (const f of PAGES) {
    const h = read(f);
    assert.ok(!h.includes(TAG), `${f}: loads the switch`);
    assert.ok(!/<template\b/.test(h), `${f}: has a <template>`);
    assert.ok(!/data-promo/.test(h), `${f}: has a data-promo attribute`);
    assert.ok(!/mpPromo\(/.test(h), `${f}: calls mpPromo`);
    assert.ok(!/STRIPE_LINK_FOUNDER|buy-banner/.test(h), `${f}: founders banner wiring left`);
  }
});

test("nothing a visitor sees or follows names a promotion", () => {
  const SAID = [/\$49\b/, /\$9\.90/, /90% off/i, /founders?'? rate/i, /FOUNDER2026|FIRST90/, /auto-applied|applied automatically/i, /\bpromo/i, /best value/i];
  for (const f of PAGES) {
    const h = read(f);
    const text = visibleText(h);
    for (const re of SAID) assert.ok(!re.test(text), `${f} says ${re}`);
    assert.ok(!/prefilled_promo_code/.test(h), `${f}: a promo checkout link is on the page`);
  }
});

test("the checkout buttons are still on each page, once each", () => {
  const want = { "index.html": ["buy-hero", "buy-feed"], "offer.html": ["buy"], "offer/index.html": ["cta1", "cta2"] };
  for (const f of PAGES) {
    const list = ids(read(f));
    const dup = list.filter((x, i) => list.indexOf(x) !== i);
    assert.deepEqual(dup, [], `${f}: repeated ids`);
    for (const id of want[f]) assert.ok(list.includes(id), `${f}: #${id} missing`);
  }
});

test("_headers: browsers revalidate the switch on every page view, and no other rule caches it", () => {
  const hdr = read("_headers");
  const RULE = "Cache-Control: public, max-age=0, must-revalidate";
  assert.ok(hdr.includes("\n/js/promo-switch.js\n  " + RULE + "\n"), "_headers carries the /js/promo-switch.js rule");
  // Every rule whose path matches the switch file (an unindented line is a path, "*"
  // matches anything, ":name" one segment). Exactly one matching rule may set
  // Cache-Control, so no later rule for /js/* can mix another value into it.
  const rules = [];
  for (const line of hdr.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) rules.push({ path: line.trim(), headers: [] });
    else rules[rules.length - 1].headers.push(line.trim());
  }
  const matches = (p, url) => new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*").replace(/:[A-Za-z]\w*/g, "[^/]+") + "$").test(url);
  const hits = rules.filter((r) => matches(r.path, "/js/promo-switch.js"));
  assert.ok(hits.some((r) => r.path === "/*"), "the site-wide rule matches too, so the matcher works");
  const cc = hits.flatMap((r) => r.headers.filter((h) => /^cache-control:/i.test(h)));
  assert.deepEqual(cc, [RULE]);
});

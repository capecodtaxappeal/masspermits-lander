// The promo switch (js/promo-switch.js) and the hand-written pages that use it.
//
// 2026-10-04: the homepage said a $49 first month was "Applied automatically", and
// FOUNDER2026 did not apply at checkout in two separate sessions. Every promo line on
// index.html, offer.html and offer/index.html now sits in <template data-promo="CODE">
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

// What a browser shows with the given codes ON (all others off): templates of an ON
// code are unwrapped, every element marked data-promo-off for it is removed, and
// every other template stays inert (dropped here, as a browser never renders it).
function removeElements(html, attr) {
  const open = new RegExp(`<([a-z][a-z0-9]*)\\b[^>]*\\s${attr}[^>]*>`, "i");
  for (let m = open.exec(html); m; m = open.exec(html)) {
    const tagRe = new RegExp(`<(/?)${m[1]}\\b[^>]*>`, "gi");
    tagRe.lastIndex = m.index;
    let depth = 0, end = -1;
    for (let t = tagRe.exec(html); t; t = tagRe.exec(html)) {
      depth += t[1] ? -1 : 1;
      if (depth === 0) { end = tagRe.lastIndex; break; }
    }
    assert.ok(end > m.index, `unbalanced <${m[1]} ${attr}>`);
    html = html.slice(0, m.index) + html.slice(end);
  }
  return html;
}
function rendered(html, on = []) {
  for (const code of on) {
    html = html.replace(new RegExp(`<template data-promo="${code}">([\\s\\S]*?)</template>`, "g"), "$1");
    html = removeElements(html, `data-promo-off="${code}"`);
  }
  return html.replace(/<template\b[\s\S]*?<\/template>/g, "");
}
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

test("each page loads the switch once, in <head>, without async or defer", () => {
  for (const f of PAGES) {
    const h = read(f);
    assert.equal(h.split(TAG).length, 2, f);
    assert.ok(h.indexOf(TAG) < h.indexOf("</head>"), f + ": before the body, so an ON code does not move the layout");
  }
});

test("every promo template names a known code and is followed at once by its mpPromo call", () => {
  let templates = 0;
  for (const f of PAGES) {
    const h = read(f);
    for (const m of h.matchAll(/data-promo(?:-off)?="([^"]*)"/g)) assert.ok(CODES.includes(m[1]), `${f}: unknown code ${m[1]}`);
    const all = [...h.matchAll(/<template\b[^>]*>/g)];
    const wired = [...h.matchAll(/<template data-promo="(\w+)">[\s\S]*?<\/template>\s*(<script>[^<]*<\/script>)/g)];
    assert.equal(wired.length, all.length, `${f}: every <template> is a promo template`);
    for (const m of wired) assert.equal(m[2], call(m[1]), `${f}: ${m[1]} template is followed by its call`);
    templates += all.length;
  }
  assert.ok(templates >= 6, "the banner, the pricing line and the offer-page blocks are all switched");
});

test("with every code off, nothing a visitor sees or follows names a promotion", () => {
  const SAID = [/\$49\b/, /\$9\.90/, /90% off/i, /founders?'? rate/i, /FOUNDER2026|FIRST90/, /auto-applied|applied automatically/i, /\bpromo/i];
  for (const f of PAGES) {
    const off = rendered(read(f));
    const text = visibleText(off);
    for (const re of SAID) assert.ok(!re.test(text), `${f} says ${re} with every code off`);
    // links and buttons: no checkout link carries a promotion code
    assert.ok(!/prefilled_promo_code/.test(noScripts(noComments(off))), `${f}: a promo checkout link is live with every code off`);
    // the head is never switched, so it may not promise one either
    const head = off.slice(0, off.indexOf("</head>"));
    for (const re of SAID) assert.ok(!re.test(head.replace(/<!--[\s\S]*?-->/g, "").replace(/<script\b[\s\S]*?<\/script>/gi, "")), `${f} <head> says ${re}`);
  }
  // the homepage's only promo link outside a template is the script constant that the
  // banner (inside the template) uses; it is applied to #buy-banner and nothing else
  const js = read("index.html").match(/<script>\s*\/\/ ── CONFIG[\s\S]*?<\/script>/)[0];
  assert.equal(js.split("STRIPE_LINK_FOUNDER").length - 1, 2, "STRIPE_LINK_FOUNDER is declared once and used once, for the banner");
  assert.ok(/banner = \$\("buy-banner"\), founderUrl = stripeWith\(STRIPE_LINK_FOUNDER\); if \(banner && founderUrl\)/.test(js));
});

test("with a code on, its lines appear, their full-price twins go, and no id repeats", () => {
  const want = { "index.html": ["buy-banner", "buy-hero", "buy-feed"], "offer.html": ["buy"], "offer/index.html": ["cta1", "cta2"] };
  for (const f of PAGES) {
    for (const on of [[], ["FOUNDER2026"], ["FIRST90"], CODES]) {
      const h = rendered(read(f), on);
      const list = ids(h);
      const dup = list.filter((x, i) => list.indexOf(x) !== i);
      assert.deepEqual(dup, [], `${f} with ${on.join("+") || "nothing"} on: repeated ids`);
      for (const id of want[f]) {
        if (id === "buy-banner" && !on.includes("FOUNDER2026")) { assert.ok(!list.includes(id)); continue; }
        assert.ok(list.includes(id), `${f} with ${on.join("+") || "nothing"} on: #${id} missing`);
      }
    }
  }
  assert.match(visibleText(rendered(read("index.html"), ["FOUNDER2026"])), /first month of the Weekly Feed for \$49/);
  assert.match(visibleText(rendered(read("offer/index.html"), ["FIRST90"])), /\$9\.90/);
  assert.match(visibleText(rendered(read("offer.html"), ["FIRST90"])), /code FIRST90 auto-applied/);
});

// Assembles docs/mission/demo.html from this branch's own page files and the
// route's real responses. Pure: no fetch, no stub, no file write, no
// top-level side effect. demo.test.mjs gathers the inputs and decides whether
// to write the result.

import { createHash } from "node:crypto";

export const DEMO_TITLE = (variant) => "Mission Control demo, design " + variant;
export const DEMO_NOTE = "Demo with invented data. Nothing on this page is real.";
export const SCENARIO_NAMES = ["Quiet day", "Bad day", "All good", "Cannot read", "Not set up"];

export const sha256 = (s) => "sha256-" + createHash("sha256").update(s, "utf8").digest("base64");

// <, >, &, U+2028 and U+2029 as six-character escapes: a hostile string can
// never form markup or end the <script> block. Valid inside JSON strings,
// and these characters never occur outside a string in JSON.
export function escapeJson(text) {
  return text.replace(/[<>&\u2028\u2029]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

// The page's ES modules as one classic script: mission-view.js with its
// "export " keywords removed, then mission-render.js without its one import
// and its "export " keywords. Nothing else changes.
export function inlineModules(view, render) {
  const v = view.replace(/^export (?=const |function |async function )/gm, "");
  const imp = /^import \{[^}]*\} from "\.\/mission-view\.js";\n/m;
  if (!imp.test(render)) throw new Error("mission-render.js import not found");
  const r = render.replace(imp, "").replace(/^export (?=const |function |async function )/gm, "");
  for (const src of [v, r]) {
    if (/^\s*(import|export)\b/m.test(src)) throw new Error("module syntax left after inlining");
  }
  return v + "\n" + r;
}

const BOOT = `
// Demo boot: renders the embedded responses with the page's own render().
const SCENARIOS = JSON.parse(document.getElementById("demo-scenarios").textContent);
const GEOMETRY = JSON.parse(document.getElementById("demo-towns").textContent);
const demoRoot = document.getElementById("mission");
const demoBar = document.getElementById("demo-bar");
let demoCurrent = 0;
function demoButtons(attr) {
  const out = [];
  const walk = (n) => {
    for (const c of n.children) {
      if (c.getAttribute(attr) !== null) out.push(c);
      walk(c);
    }
  };
  walk(demoBar);
  return out;
}
function demoShow(i) {
  demoCurrent = i;
  const s = SCENARIOS[i];
  render(demoRoot, { main: s.main, map: s.map, towns: { status: 200, json: GEOMETRY } }, {
    now: Date.parse(s.now),
    onRefresh: () => demoShow(demoCurrent),
    onEdit: (town, value, done) => done(TEXT.demoSaved),
    inert: true,
  });
  for (const b of demoButtons("data-scenario")) {
    b.setAttribute("aria-pressed", b.getAttribute("data-scenario") === String(i) ? "true" : "false");
  }
}
for (const b of demoButtons("data-scenario")) {
  b.addEventListener("click", () => demoShow(Number(b.getAttribute("data-scenario"))));
}
for (const b of demoButtons("data-theme-set")) {
  b.addEventListener("click", () => {
    const t = b.getAttribute("data-theme-set");
    if (t === "device") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
    for (const x of demoButtons("data-theme-set")) x.setAttribute("aria-pressed", x === b ? "true" : "false");
  });
}
demoShow(0);
`;

const BAR_CSS = `
.demo-bar { background: var(--ink); color: var(--paper); padding: 6px 16px; font: 16px/1.3 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.demo-bar p { margin: 0 0 4px; font-weight: 700; max-width: none; }
.demo-row { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; }
.demo-row button { flex: none; background: var(--ink); color: var(--paper); border-color: var(--paper); padding: 6px 10px; }
.demo-row button[aria-pressed="true"] { background: var(--paper); color: var(--ink); }
.demo-row .demo-gap { flex: none; width: 10px; }
`;

// files: {html, css, view, render, towns} as text; scenarios: [{name, now, main, map}]
export function buildDemo({ variant, files, scenarios }) {
  const html = files.html;
  const body = html.slice(html.indexOf("<body>") + "<body>".length, html.indexOf("</body>")).trim();
  if (/<script\b/i.test(body)) throw new Error("the page body must hold no script");
  const script = "\n(() => {\n\"use strict\";\n" + inlineModules(files.view, files.render) + BOOT + "})();\n";
  const style = "\n" + files.css + BAR_CSS;
  const csp = "default-src 'none'; script-src '" + sha256(script) + "'; style-src '" + sha256(style) +
    "'; img-src data:; connect-src 'none'; font-src 'none'; form-action 'none'; base-uri 'none'";
  const bar = [
    '<div id="demo-bar" class="demo-bar">',
    "<p>" + DEMO_NOTE + "</p>",
    '<div class="demo-row">' + SCENARIO_NAMES.map((n, i) =>
      '<button type="button" data-scenario="' + i + '">' + (i + 1) + " " + n + "</button>").join("") +
      '<span class="demo-gap"></span>' + ["Light", "Dark", "Device"].map((n) =>
      '<button type="button" data-theme-set="' + n.toLowerCase() + '">' + n + "</button>").join("") + "</div>",
    "</div>",
  ].join("\n");
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta http-equiv="Content-Security-Policy" content="' + csp + '">',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex,nofollow">',
    "<title>" + DEMO_TITLE(variant) + "</title>",
    "<style>" + style + "</style>",
    "</head>",
    "<body>",
    bar,
    body,
    '<script type="application/json" id="demo-towns">' + escapeJson(files.towns.trim()) + "</script>",
    '<script type="application/json" id="demo-scenarios">' + escapeJson(JSON.stringify(scenarios)) + "</script>",
    "<script>" + script + "</script>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

// Mission Control offline demo: a PURE HTML assembler (test-only).
//
// buildDemo() takes this branch's own page files as text (the CSS, the view
// and render modules, the page shell from admin/mission.html, the geometry)
// plus payloads the real route answered, and returns one self-contained HTML
// string. No fetch, no stub, no file write, no top-level side effect: the
// caller (demo.test.mjs) reads the files and decides where the result goes.
//
// The two ES modules become one classic inline script: mission-view.js is
// wrapped as the namespace object `V` that mission-render.js imports, and the
// `export` keywords are dropped. mission-app.js (the only file that makes a
// request) is not in the demo; a small boot calls render() instead.

import { createHash } from "node:crypto";

export const DEMO_BAR_TEXT = "Demo with invented data. Nothing on this page is real.";
export const SCENARIO_NAMES = ["Quiet day", "Bad day", "All good", "Cannot read", "Not set up"];
export const DEMO_EDIT_TEXT = "Demo: nothing is saved";
const VIEW_IMPORT = 'import * as V from "./mission-view.js";';
const SHELL_START = "<!-- mission shell: start -->";
const SHELL_END = "<!-- mission shell: end -->";

export const sha256b64 = (s) => createHash("sha256").update(s, "utf8").digest("base64");

export function demoTitle(variant) {
  return "Mission Control demo, design " + variant;
}

export function demoCsp(scriptHash, styleHash) {
  return "default-src 'none'; script-src 'sha256-" + scriptHash + "'; style-src 'sha256-" + styleHash +
    "'; img-src data:; connect-src 'none'; font-src 'none'; form-action 'none'; base-uri 'none'";
}

// JSON safe inside a <script> block: no character that can form markup.
export function embedJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export function exportNames(src) {
  return [...src.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z0-9_$]+)/gm)].map((m) => m[1]);
}

function stripExports(src) {
  return src.replace(/^export\s+(?=(?:async\s+)?(?:function|const|let|class)\b)/gm, "");
}

export function shellOf(missionHtml) {
  const a = missionHtml.indexOf(SHELL_START);
  const b = missionHtml.indexOf(SHELL_END);
  if (a < 0 || b < a) throw new Error("mission.html has no shell markers");
  return missionHtml.slice(a + SHELL_START.length, b).trim();
}

export function pageScript(viewSrc, renderSrc) {
  if (/^\s*import\b/m.test(viewSrc)) throw new Error("mission-view.js must import nothing");
  const imports = renderSrc.match(/^\s*import\b.*$/gm) || [];
  if (imports.length !== 1 || imports[0].trim() !== VIEW_IMPORT) throw new Error("unexpected import in mission-render.js");
  const names = exportNames(viewSrc);
  return "var V = (function () {\n" + stripExports(viewSrc) + "\nreturn { " +
    names.map((n) => n + ": " + n).join(", ") + " };\n})();\n" +
    stripExports(renderSrc.replace(VIEW_IMPORT, ""));
}

// The demo's own boot: builds the demo bar outside the page root, switches
// scenarios and themes, and keeps every link and edit inert.
const BOOT = `
var DEMO_TEXT = ${JSON.stringify(DEMO_BAR_TEXT)};
var DEMO_EDIT = ${JSON.stringify(DEMO_EDIT_TEXT)};
var NAMES = ${JSON.stringify(SCENARIO_NAMES)};
var THEMES = ["device", "light", "dark"];
var THEME_WORDS = { device: "Device", light: "Light", dark: "Dark" };
var scenarios = JSON.parse(document.getElementById("demo-scenarios").textContent);
var geometry = { status: 200, body: JSON.parse(document.getElementById("demo-towns").textContent) };
var root = document.getElementById("mc-root");
var setup = document.getElementById("mc-setup");
var html = document.documentElement;
var current = 0;
var theme = "device";
var buttons = [];

var bar = document.createElement("div");
bar.setAttribute("class", "demo-bar");
bar.setAttribute("data-part", "demo-bar");
var line = document.createElement("p");
line.setAttribute("class", "demo-text");
var strong = document.createElement("strong");
strong.textContent = DEMO_TEXT;
line.appendChild(strong);
bar.appendChild(line);
var row = document.createElement("div");
row.setAttribute("class", "demo-row");
var which = document.createElement("span");
which.setAttribute("class", "demo-which");
NAMES.forEach(function (name, i) {
  var b = document.createElement("button");
  b.setAttribute("type", "button");
  b.setAttribute("class", "demo-btn");
  b.setAttribute("aria-label", "Scenario " + (i + 1) + ": " + name);
  b.setAttribute("data-scenario", String(i));
  b.textContent = String(i + 1);
  b.addEventListener("click", function () { show(i); });
  buttons.push(b);
  row.appendChild(b);
});
var themeBtn = document.createElement("button");
themeBtn.setAttribute("type", "button");
themeBtn.setAttribute("class", "demo-btn demo-theme");
themeBtn.setAttribute("data-part", "demo-theme");
themeBtn.addEventListener("click", function () {
  setTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]);
});
row.appendChild(which);
row.appendChild(themeBtn);
bar.appendChild(row);
document.body.appendChild(bar);

function setTheme(t) {
  theme = t;
  if (t === "device") html.removeAttribute("data-theme");
  else html.setAttribute("data-theme", t);
  themeBtn.textContent = THEME_WORDS[t];
  themeBtn.setAttribute("aria-label", "Theme: " + THEME_WORDS[t] + " (Light / Dark / Device)");
}

function show(i) {
  current = i;
  var s = scenarios[i];
  render(root, { main: s.main, map: s.map, towns: geometry }, {
    now: Date.parse(s.now),
    onRefresh: function () { show(current); },
    onEdit: function () { return DEMO_EDIT; },
    setup: setup,
    href: function () { return "#"; }
  });
  buttons.forEach(function (b, k) { b.setAttribute("aria-pressed", k === i ? "true" : "false"); });
  which.textContent = NAMES[i];
}

document.addEventListener("click", function (e) {
  for (var n = e.target; n; n = n.parentNode) {
    if (n.tagName === "A") { e.preventDefault(); return; }
  }
});

var start = 0;
if (typeof location !== "undefined" && location.hash) {
  var m = /s=([1-5])/.exec(location.hash);
  if (m) start = Number(m[1]) - 1;
  var t = /t=(light|dark|device)/.exec(location.hash);
  if (t) theme = t[1];
}
setTheme(theme);
show(start);
`;

const DEMO_CSS = `
/* demo bar (demo only): fixed at the bottom, outside the page root */
body { padding-bottom: 80px; }
.demo-bar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 5;
  background: var(--surface); color: var(--text); border-top: 2px solid var(--accent);
  padding: 4px 16px 6px; font-size: 12px; line-height: 1.3;
}
.demo-text { margin: 0 0 4px; }
.demo-row { display: flex; align-items: center; gap: 4px; }
.demo-btn {
  flex: none; min-width: 36px; min-height: 36px; padding: 0 8px; border: 1px solid var(--line); border-radius: 8px;
  background: var(--surface-2); color: var(--text); font: inherit; font-size: 15px; cursor: pointer;
}
.demo-btn[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); font-weight: 700; }
.demo-which { flex: 1 1 auto; min-width: 0; font-size: 14px; font-weight: 600; padding-left: 4px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
`;

// scenarios: [{name, now, main:{status, body}, map:{status, body}}]
export function buildDemo({ variant, css, viewSrc, renderSrc, missionHtml, geometryText, scenarios }) {
  const style = css + DEMO_CSS;
  const script = "(function () {\n\"use strict\";\n" + pageScript(viewSrc, renderSrc) + BOOT + "})();\n";
  const csp = demoCsp(sha256b64(script), sha256b64(style));
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta http-equiv="Content-Security-Policy" content="' + csp + '">',
    '<meta name="robots" content="noindex,nofollow">',
    "<title>" + demoTitle(variant) + "</title>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<style>" + style + "</style>",
    "</head>",
    "<body>",
    shellOf(missionHtml),
    '<script type="application/json" id="demo-towns">' + embedJson(JSON.parse(geometryText)) + "</script>",
    '<script type="application/json" id="demo-scenarios">' + embedJson(scenarios) + "</script>",
    "<script>" + script + "</script>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

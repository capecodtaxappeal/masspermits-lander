// A pure HTML assembler for the offline demo (docs/mission/demo.html).
// No fetch, no stub, no file write, no top-level side effect: the caller
// reads the shipped page files and runs the real route, then hands the
// strings and the route's responses to buildDemo(), which returns one
// self-contained HTML string.
//
// The demo IS the page: the same mission-app.css, mission-view.js and
// mission-render.js, and mission.html's own shell markup, plus a small boot
// that calls render() with the embedded payloads. mission-app.js (the only
// file that fetches) is not in it.

import { createHash } from "node:crypto";

export const DEMO_BAR_TEXT = "Demo with invented data. Nothing on this page is real.";
export const demoTitle = (variant) => "Mission Control demo, design " + variant;

export const sha256 = (s) => "'sha256-" + createHash("sha256").update(s, "utf8").digest("base64") + "'";

// JSON that can sit inside <script type="application/json"> and never form
// markup: <, >, &, U+2028 and U+2029 become six-character escapes.
export function embedJson(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

// ES module source -> plain declarations for one shared function scope.
export function unmodule(src) {
  return src
    .replace(/^import\s[\s\S]*?\sfrom\s*["'][^"']+["'];\s*$/gm, "")
    .replace(/^export\s+(?=(async\s+)?function\b|const\b|let\b|class\b)/gm, "");
}

// mission.html's markup between <!-- shell --> and <!-- /shell -->, with
// every href turned into "#" (the demo's links keep their look, go nowhere).
export function shellOf(html) {
  const a = html.indexOf("<!-- shell -->");
  const b = html.indexOf("<!-- /shell -->");
  if (a < 0 || b < a) throw new Error("mission.html has no shell markers");
  return html.slice(a + "<!-- shell -->".length, b).trim().replace(/href="[^"]*"/g, 'href="#"');
}

const DEMO_CSS = `
.demo-bar { max-width: 1280px; margin: 0 auto; padding: 4px 16px 6px; border-bottom: 2px dashed var(--watch);
  background: var(--surface); color: var(--text); }
.demo-t { margin: 0 0 4px; font-weight: 700; font-size: var(--fs-meta); }
.demo-strip { display: flex; flex-wrap: nowrap; gap: 4px; overflow-x: auto; }
.demo-row { display: flex; flex-wrap: nowrap; gap: 4px; flex-shrink: 0; }
.demo-row + .demo-row { border-left: 1px solid var(--rule); padding-left: 4px; }
.demo-row .btn { white-space: nowrap; min-height: 36px; padding: 0 8px; }
.demo-row .btn[aria-pressed="true"] { background: var(--text); color: var(--surface); }
`;

// The boot: picks a scenario, renders it, wires the demo bar. It reads only
// the embedded JSON; it never stores anything and never asks the network.
const BOOT = `
var DEMO_GEO = JSON.parse(document.getElementById("demo-towns").textContent);
var DEMO_SCEN = JSON.parse(document.getElementById("demo-scenarios").textContent);
var demoRoot = document.getElementById("mission-root");
var demoSetup = document.getElementById("setup-needed");
var demoScenRow = document.getElementById("demo-scen");
var demoThemeRow = document.getElementById("demo-theme");
var demoCurrent = 0;
function demoShow(i) {
  demoCurrent = i;
  var s = DEMO_SCEN[i];
  render(demoRoot, { main: s.main, map: s.map, towns: DEMO_GEO }, {
    now: Date.parse(s.now),
    onRefresh: function () { demoShow(demoCurrent); },
    onEdit: function () { return MSG.demoEdit; },
    link: function () { return "#"; },
    setup: demoSetup,
  });
  demoScenRow.childNodes.forEach(function (b, j) { b.setAttribute("aria-pressed", j === i ? "true" : "false"); });
}
function demoTheme(t) {
  var html = document.documentElement;
  if (t === "light" || t === "dark") html.setAttribute("data-theme", t); else html.removeAttribute("data-theme");
  demoThemeRow.childNodes.forEach(function (b) {
    b.setAttribute("aria-pressed", b.getAttribute("data-theme-set") === (t || "device") ? "true" : "false");
  });
}
DEMO_SCEN.forEach(function (s, i) {
  var b = document.createElement("button");
  b.setAttribute("type", "button");
  b.setAttribute("class", "btn");
  b.textContent = (i + 1) + " " + s.label;
  b.addEventListener("click", function () { demoShow(i); });
  demoScenRow.appendChild(b);
});
[["light", "Light"], ["dark", "Dark"], ["device", "Device"]].forEach(function (p) {
  var b = document.createElement("button");
  b.setAttribute("type", "button");
  b.setAttribute("class", "btn");
  b.setAttribute("data-theme-set", p[0]);
  b.textContent = p[1];
  b.addEventListener("click", function () { demoTheme(p[0]); });
  demoThemeRow.appendChild(b);
});
var demoStart = 0, demoStartTheme = "device";
try {
  var demoHash = typeof location !== "undefined" ? String(location.hash || "") : "";
  var mS = /[#&]s=([1-5])/.exec(demoHash), mT = /[#&]t=(light|dark)/.exec(demoHash);
  if (mS) demoStart = Number(mS[1]) - 1;
  if (mT) demoStartTheme = mT[1];
} catch (e) { demoStart = 0; }
demoTheme(demoStartTheme);
demoShow(demoStart);
`;

// scenarios: [{label, now, main:{status, body}, map:{status, body}}]
export function buildDemo({ variant, css, view, render, shellHtml, towns, scenarios }) {
  const style = css + DEMO_CSS;
  const script = "(function () {\n\"use strict\";\n" + unmodule(view) + "\n" + unmodule(render) + "\n" + BOOT + "})();\n";
  const csp = "default-src 'none'; script-src " + sha256(script) + "; style-src " + sha256(style) +
    "; img-src data:; connect-src 'none'; font-src 'none'; form-action 'none'; base-uri 'none'";
  return "<!doctype html>\n<html lang=\"en\">\n<head>\n" +
    "<meta http-equiv=\"Content-Security-Policy\" content=\"" + csp + "\">\n" +
    "<meta name=\"robots\" content=\"noindex,nofollow\">\n" +
    "<title>" + demoTitle(variant) + "</title>\n" +
    "<meta charset=\"utf-8\">\n" +
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n" +
    "<style>" + style + "</style>\n" +
    "</head>\n<body>\n" +
    "<div class=\"demo-bar\" id=\"demo-bar\" role=\"region\" aria-label=\"Demo controls\">\n" +
    "<p class=\"demo-t\">" + DEMO_BAR_TEXT + "</p>\n" +
    "<div class=\"demo-strip\"><div class=\"demo-row\" id=\"demo-scen\"></div>" +
    "<div class=\"demo-row\" id=\"demo-theme\"></div></div>\n" +
    "</div>\n" +
    shellOf(shellHtml) + "\n" +
    "<script type=\"application/json\" id=\"demo-towns\">" + embedJson(JSON.parse(towns)) + "</script>\n" +
    "<script type=\"application/json\" id=\"demo-scenarios\">" + embedJson(scenarios) + "</script>\n" +
    "<script>" + script + "</script>\n" +
    "</body>\n</html>\n";
}

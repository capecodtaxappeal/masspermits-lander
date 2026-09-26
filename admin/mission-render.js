// Mission Control: DOM building only. No request, no storage, no timer: the
// clock and every action come in through opts, so the offline demo runs this
// file unchanged. Every value goes in with textContent or setAttribute.

import {
  TEXT, screenOf, mapOk, tilesView, headlineView, needsView, sectionsView, legendView, mapLabel,
  listGroups, townSheet, codeOf, dateline, when, OUTREACH_CHOICES,
} from "./mission-view.js";

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.setAttribute("class", cls);
  if (text !== undefined && text !== null) e.textContent = String(text);
  return e;
}
function add(parent, ...kids) {
  for (const k of kids) if (k) parent.appendChild(k);
  return parent;
}
function part(e, name) {
  e.setAttribute("data-part", name);
  return e;
}
function button(text, cls, onClick) {
  const b = el("button", cls, text);
  b.setAttribute("type", "button");
  b.addEventListener("click", onClick);
  return b;
}
function link(text, href, o) {
  const a = el("a", "", text);
  a.setAttribute("href", o.inert ? "#" : href);
  if (o.inert) a.addEventListener("click", (e) => e.preventDefault());
  return a;
}

function masthead(app, main, o) {
  const h = add(el("header", "masthead"), el("h1", "title", "Mission Control"));
  const line = add(el("div", "dateline"), el("span", "date", dateline(o.now)));
  add(line, button("Refresh", "refresh", () => o.onRefresh && o.onRefresh()));
  add(h, line);
  if (main && main.signed_in_as) add(h, part(el("p", "signed", "Signed in as " + main.signed_in_as), "signed-in"));
  add(app, h);
}

function headline(parent, hv) {
  const box = el("div", "headline " + hv.cls);
  box.setAttribute("role", "status");
  box.setAttribute("aria-live", "polite");
  add(box, el("span", "kicker", hv.word), part(el("p", "lede", hv.text), "headline-text"));
  add(parent, box);
}

function glance(parent, tiles) {
  const sec = add(el("section", "glance"), el("h2", "", "At a glance"));
  const ul = el("ul", "tiles");
  const notes = el("dl", "notes");
  for (const t of tiles) {
    const li = el("li", "tile " + t.cls);
    li.setAttribute("data-tile", t.id);
    li.setAttribute("aria-label", t.label + ": " + t.value + ", " + t.word);
    const w = add(part(el("span", "word"), "word-box"), el("span", "mark"), part(el("span", "w", t.word), "word"));
    add(ul, add(li, el("span", "label", t.label), add(el("span", "fig"), el("span", "value", t.value), w)));
    add(notes, el("dt", "", t.label), el("dd", "", t.sub + (t.asOf ? " (as of " + t.asOf + ")" : "")));
  }
  const fine = add(el("details", "fine"), add(el("summary"), el("span", "", "How these were counted")), notes);
  add(parent, add(sec, ul, fine));
}

function needs(parent, nv) {
  const sec = add(el("section", "needs"), el("h2", "", "Needs you"));
  if (nv.urgent.length) {
    const ol = el("ol", "urgent");
    for (const l of nv.urgent) {
      const li = part(el("li", "need " + l.cls), "need");
      add(li, el("span", "w", l.word), part(el("span", "t", " " + l.text), "need-text"), el("span", "where", "Where: " + l.where));
      add(ol, li);
    }
    add(sec, ol);
  }
  if (nv.known.length) {
    const ul = el("ul", "known-list");
    for (const l of nv.known) add(ul, add(el("li", "need " + l.cls), el("span", "t", l.text), el("span", "where", "Where: " + l.where)));
    add(sec, add(el("details", "known"), add(el("summary"), el("span", "", nv.knownTitle)), ul));
  }
  add(parent, sec);
}

// The sheet: one panel reused for every town; focus goes in and comes back.
function sheetFor(app, main, map, o) {
  const s = el("div", "sheet");
  s.setAttribute("role", "dialog");
  s.setAttribute("aria-labelledby", "sheet-title");
  s.hidden = true;
  const title = el("h2", "sheet-title");
  title.setAttribute("id", "sheet-title");
  const body = el("div", "sheet-body");
  const status = part(el("p", "sheet-status"), "sheet-status");
  status.setAttribute("aria-live", "polite");
  let back = null;
  const close = () => {
    s.hidden = true;
    if (back && back.focus) back.focus();
  };
  const x = button("Close", "close", close);
  s.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  add(s, add(el("div", "sheet-head"), title, x), body, status);
  add(app, s);
  return (key) => {
    const v = townSheet(key, map.towns[key]);
    back = document.activeElement || null;
    title.textContent = v.title;
    status.textContent = "";
    body.replaceChildren();
    const ul = el("ul", "facts");
    for (const l of v.lines) add(ul, el("li", "", l));
    add(body, ul);
    if (main && main.outreach_edit === true && o.onEdit) {
      const row = el("div", "edit");
      for (const [val, label] of OUTREACH_CHOICES) {
        const b = button(label, "choice", () => o.onEdit(key, val, (msg) => { status.textContent = msg; }));
        if (val === v.outreach) b.setAttribute("aria-current", "true");
        add(row, b);
      }
      add(body, row);
    }
    s.hidden = false;
    x.focus();
  };
}

function mapFigure(parent, main, data, o, ns) {
  const sec = add(el("section", "map"), el("h2", "", "The map"));
  add(parent, sec);
  if (!mapOk(data.map, data.towns)) {
    add(sec, part(el("p", "map-failed", TEXT.mapFailed), "map-failed"));
    return;
  }
  const map = data.map.json, geo = data.towns.json;
  const open = sheetFor(parent, main, map, o);
  const fig = el("figure", "figure");
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", geo.viewBox || "0 0 2000 1272");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", mapLabel(map));
  svg.setAttribute("class", "towns");
  const g = document.createElementNS(ns, "g");
  const keys = Object.keys(geo.towns);
  for (const k of keys) {
    const f = map.towns[k];
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", geo.towns[k].d);
    p.setAttribute("data-town", k);
    p.setAttribute("fill-rule", "evenodd");
    p.setAttribute("class", "t m-" + codeOf(f) + (f && f.planned ? " planned" : ""));
    g.appendChild(p);
  }
  svg.appendChild(g);
  svg.addEventListener("click", (e) => {
    const k = e.target && e.target.getAttribute && e.target.getAttribute("data-town");
    if (k) open(k);
  });
  const legend = el("ul", "legend");
  for (const l of legendView(map)) add(legend, add(el("li", "", ""), el("span", "sw " + l.cls), el("span", "lt", l.text), el("span", "lc", String(l.count))));
  const cap = add(el("figcaption"), el("p", "cap", "The 351 towns by source status" +
    (map.as_of && map.as_of.source_health ? ", as of " + when(map.as_of.source_health) : "") + ". Tap a town for its facts."),
  legend, el("p", "attr", TEXT.attribution));
  add(sec, add(fig, svg, cap));

  const listBox = el("div", "town-list");
  listBox.hidden = true;
  const toggle = button("Show as list", "toggle", () => {
    const on = listBox.hidden;
    listBox.hidden = !on;
    toggle.setAttribute("aria-pressed", on ? "true" : "false");
    toggle.textContent = on ? "Show the map" : "Show as list";
    fig.hidden = on;
    if (on && !listBox.firstChild) {
      for (const grp of listGroups(map, keys)) {
        const ul = el("ul", "towns-in");
        for (const k of grp.towns) add(ul, add(el("li"), button(k, "town", () => open(k))));
        add(listBox, add(el("details", "grp"), add(el("summary"), el("span", "sw " + grp.cls), el("span", "", grp.text + " (" + grp.count + ")")), ul));
      }
    }
  });
  toggle.setAttribute("aria-pressed", "false");
  add(sec, toggle, listBox);
}

function sections(parent, main, map, o) {
  const wrap = add(el("div", "sections"));
  for (const s of sectionsView(main, map)) {
    const d = el("details", "sec");
    d.setAttribute("data-section", s.id);
    add(d, add(el("summary"), el("h2", "", s.title)));
    for (const p of s.paras) add(d, el("p", "", p));
    for (const l of s.lists) {
      if (l.title) add(d, el("h3", "", l.title));
      if (!l.items.length) { add(d, el("p", "none", "None.")); continue; }
      const ul = el("ul", "rows");
      for (const it of l.items) {
        const li = el("li", "", it.text);
        if (it.href) add(li, el("span", "", " · "), link("Stripe", it.href, o));
        add(ul, li);
      }
      add(d, ul);
      if (l.more) add(d, el("p", "", l.more));
    }
    add(wrap, d);
  }
  add(parent, wrap);
}

function footer(app, o) {
  add(app, add(el("footer", "foot"), link("Pipeline", "/admin/pipeline", o), el("span", "", " · "), link("Now", "/admin/now", o)));
}

// render(root, {main, map, towns}, {now, onRefresh, onEdit, inert})
// main/map/towns: {status, json} or null while loading.
export function render(root, data, o) {
  const find = (id) => document.getElementById(id);
  const app = find("app"), setup = find("setup-needed"), ns = find("svg-ns").namespaceURI;
  const scr = screenOf(data.main);
  setup.hidden = scr !== "setup";
  app.replaceChildren();
  root.setAttribute("data-screen", scr);
  if (scr === "setup") return;
  const main = scr === "ok" ? data.main.json : null;
  masthead(app, main, o);
  const body = el("main", "body");
  add(app, body);
  if (scr !== "ok") {
    add(body, part(el("p", "notice", scr === "loading" ? TEXT.loading : scr === "not-owner" ? TEXT.notOwner : TEXT.cannotRead), "notice"));
    footer(app, o);
    return;
  }
  headline(body, headlineView(main.headline));
  glance(body, tilesView(main.tiles));
  mapFigure(body, main, data, o, ns);
  needs(body, needsView(main.needs_you || []));
  sections(body, main, mapOk(data.map, data.towns) ? data.map.json : null, o);
  footer(app, o);
}

// Mission Control: DOM building only (no request, storage or timer), so the
// offline demo reuses it. render(root, {main, map, towns}, {now, onRefresh,
// onEdit, setup, href}); each response is {status, body}, undefined = loading.
// Values go in via textContent or setAttribute on a fixed name, never markup.

import * as V from "./mission-view.js";

let doc = null; // the document of the root being drawn (set by render)

function el(tag, cls, text) {
  const e = doc.createElement(tag);
  if (cls) e.setAttribute("class", cls);
  if (text !== undefined && text !== null) e.textContent = String(text);
  return e;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function mark(cls, word, part) {
  const s = el("span", "state " + cls);
  s.appendChild(el("span", "mark"));
  const w = el("span", "word", word);
  if (part) w.setAttribute("data-part", part);
  s.appendChild(w);
  return s;
}

function button(cls, text, onClick) {
  const b = el("button", cls, text);
  b.setAttribute("type", "button");
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

function link(url, text, opts) {
  const a = el("a", "mc-link", text);
  a.setAttribute("href", opts && typeof opts.href === "function" ? opts.href(url) : url);
  a.setAttribute("rel", "noreferrer");
  return a;
}

function header(model, opts) {
  const h = el("header", "mc-head");
  const brand = el("div", "mc-brand");
  brand.appendChild(el("h1", "mc-title", "Mission Control"));
  if (model && model.signedInAs) {
    const who = el("p", "mc-who", "Signed in as " + model.signedInAs);
    who.setAttribute("data-part", "signed-in");
    brand.appendChild(who);
  }
  h.appendChild(brand);
  if (opts && typeof opts.onRefresh === "function") {
    const b = button("mc-btn mc-refresh", "\u21bb", () => opts.onRefresh());
    b.setAttribute("aria-label", "Refresh");
    b.setAttribute("title", "Refresh");
    b.setAttribute("data-part", "refresh");
    h.appendChild(b);
  }
  return h;
}

function footer(opts) {
  const f = el("footer", "mc-foot");
  const nav = el("p", "mc-foot-links");
  nav.appendChild(link("/admin/pipeline", "Pipeline", opts));
  nav.appendChild(link("/admin/now", "Now", opts));
  f.appendChild(nav);
  if (opts && typeof opts.now === "number" && Number.isFinite(opts.now)) {
    f.appendChild(el("p", "mc-loaded", "Loaded " + V.timeNY(new Date(opts.now).toISOString())));
  }
  return f;
}

function headlineBox(h) {
  const box = el("section", "mc-headline " + h.cls);
  box.setAttribute("aria-live", "polite");
  box.setAttribute("aria-label", "Headline");
  box.appendChild(mark(h.cls, h.word, "headline-word"));
  const p = el("p", "mc-headline-text", h.text);
  p.setAttribute("data-part", "headline");
  box.appendChild(p);
  return box;
}

function tileList(tiles) {
  const ul = el("ul", "mc-tiles");
  ul.setAttribute("aria-label", "Status tiles");
  for (const t of tiles) {
    const li = el("li", "tile " + t.cls);
    li.setAttribute("data-tile", t.id);
    li.setAttribute("aria-label", t.aria);
    li.appendChild(el("span", "tile-label", t.label));
    const v = el("span", "tile-value", t.value);
    v.setAttribute("data-part", "tile-value");
    li.appendChild(v);
    li.appendChild(mark(t.cls, t.word, "tile-word"));
    if (t.sub) li.appendChild(el("span", "tile-sub", t.sub));
    ul.appendChild(li);
  }
  return ul;
}

function needsSection(needs) {
  const s = el("section", "mc-needs");
  s.appendChild(el("h2", "mc-h2", "Needs you"));
  if (needs.urgent.length) {
    const ol = el("ol", "mc-lines");
    for (const l of needs.urgent) {
      const li = el("li", "line " + l.cls);
      li.setAttribute("data-need", l.id);
      li.appendChild(mark(l.cls, l.word));
      const p = el("p", "line-text", l.text);
      p.setAttribute("data-part", "need");
      li.appendChild(p);
      if (l.where) li.appendChild(el("p", "line-where", "Where: " + l.where));
      ol.appendChild(li);
    }
    s.appendChild(ol);
  }
  if (needs.known.length) {
    const det = el("details", "mc-known");
    det.appendChild(el("summary", "mc-summary", needs.knownTitle));
    const ul = el("ul", "mc-lines");
    for (const l of needs.known) {
      const li = el("li", "line st-known");
      li.setAttribute("data-known", l.id);
      li.appendChild(el("p", "line-text", l.text));
      if (l.where) li.appendChild(el("p", "line-where", "Where: " + l.where));
      ul.appendChild(li);
    }
    det.appendChild(ul);
    s.appendChild(det);
  }
  return s;
}

function blocks(list, opts) {
  const wrap = el("div", "mc-detail-body");
  for (const b of list) {
    if (b.type === "text") {
      wrap.appendChild(el("p", "mc-note", b.text));
    } else if (b.type === "facts") {
      if (!b.rows.length) continue;
      const dl = el("dl", "mc-facts");
      for (const [k, v] of b.rows) {
        const row = el("div", "mc-fact");
        row.appendChild(el("dt", "", k));
        row.appendChild(el("dd", "", v));
        dl.appendChild(row);
      }
      wrap.appendChild(dl);
    } else if (b.type === "people") {
      if (!b.rows.length) {
        if (b.empty) wrap.appendChild(el("p", "mc-empty", b.empty));
        continue;
      }
      const ul = el("ul", "mc-people");
      for (const r of b.rows) {
        const li = el("li", "mc-person");
        li.appendChild(el("span", "mc-person-name", r.name));
        if (r.line) li.appendChild(el("span", "mc-person-line", r.line));
        if (r.link) li.appendChild(link(r.link, "Open in Stripe", opts));
        ul.appendChild(li);
      }
      wrap.appendChild(ul);
    }
  }
  return wrap;
}

function detailsSection(sections, opts) {
  const s = el("section", "mc-details");
  s.appendChild(el("h2", "mc-h2", "Details"));
  for (const sec of sections) {
    const det = el("details", "mc-detail");
    det.setAttribute("data-section", sec.id);
    det.appendChild(el("summary", "mc-summary", sec.title));
    det.appendChild(blocks(sec.blocks, opts));
    s.appendChild(det);
  }
  return s;
}

// The SVG namespace comes from a static <svg> in the page shell, so this file
// carries no URL at all.
function svgNamespace() {
  const n = doc.getElementById("mc-svg-ns");
  return n && n.namespaceURI ? n.namespaceURI : null;
}

function mapSection(mm, state, openTown) {
  const s = el("section", "mc-map");
  const head = el("div", "mc-map-head");
  head.appendChild(el("h2", "mc-h2", "Towns"));
  s.appendChild(head);
  const ns = svgNamespace();
  if (!mm || mm.kind !== "ok" || !ns) {
    const p = el("p", "mc-map-msg", mm === null ? V.SENTENCES.mapLoading : V.SENTENCES.mapFailed);
    p.setAttribute("data-part", "map-message");
    s.appendChild(p);
    s.appendChild(el("p", "mc-attr", V.ATTRIBUTION));
    return s;
  }
  const toggle = button("mc-btn mc-toggle", "Show as list");
  toggle.setAttribute("aria-pressed", state.list ? "true" : "false");

  // assembled off-document, attached in one step
  const fig = el("figure", "mc-figure");
  const svg = doc.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", mm.viewBox);
  svg.setAttribute("class", "mc-svg");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", mm.summary);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  const g = doc.createElementNS(ns, "g");
  g.setAttribute("fill-rule", mm.fillRule);
  const planned = doc.createElementNS(ns, "g");
  planned.setAttribute("class", "planned-layer");
  for (const p of mm.paths) {
    const f = mm.fills[p.key];
    const path = doc.createElementNS(ns, "path");
    path.setAttribute("d", p.d);
    path.setAttribute("data-town", p.key);
    path.setAttribute("class", "town k-" + f.code);
    g.appendChild(path);
    if (f.planned) {
      const o = doc.createElementNS(ns, "path");
      o.setAttribute("d", p.d);
      o.setAttribute("data-town", p.key);
      o.setAttribute("class", "town-planned");
      planned.appendChild(o);
    }
  }
  svg.appendChild(g);
  svg.appendChild(planned);
  svg.addEventListener("click", (e) => {
    const t = e && e.target && typeof e.target.getAttribute === "function" ? e.target.getAttribute("data-town") : null;
    if (t) openTown(t, null);
  });
  fig.appendChild(svg);
  s.appendChild(fig);

  const legend = el("ul", "mc-legend");
  legend.setAttribute("aria-label", "Legend");
  for (const l of mm.legend) {
    const li = el("li", "mc-legend-item");
    li.setAttribute("data-code", l.code);
    li.appendChild(el("span", "swatch " + l.cls));
    li.appendChild(el("span", "mc-legend-label", l.label));
    li.appendChild(el("span", "mc-legend-count", V.count(l.count)));
    legend.appendChild(li);
  }
  s.appendChild(legend);
  const tools = el("div", "mc-map-tools");
  tools.appendChild(toggle);
  s.appendChild(tools);

  const list = el("div", "mc-townlist");
  list.setAttribute("data-part", "town-list");
  for (const grp of mm.groups) {
    if (!grp.towns.length) continue;
    const h = el("h3", "mc-h3");
    h.appendChild(el("span", "swatch " + grp.cls));
    h.appendChild(el("span", "", grp.label + " (" + grp.towns.length + ")"));
    list.appendChild(h);
    const ul = el("ul", "mc-towns");
    for (const t of grp.towns) {
      const li = el("li", "");
      const b = button("mc-town", t);
      b.addEventListener("click", () => openTown(t, b));
      li.appendChild(b);
      ul.appendChild(li);
    }
    list.appendChild(ul);
  }
  list.hidden = !state.list;
  fig.hidden = state.list;
  toggle.addEventListener("click", () => {
    state.list = !state.list;
    toggle.setAttribute("aria-pressed", state.list ? "true" : "false");
    list.hidden = !state.list;
    fig.hidden = state.list;
  });
  s.appendChild(list);
  s.appendChild(el("p", "mc-attr", V.ATTRIBUTION));
  return s;
}

function sheet(root, sh, edit, onEdit, returnTo) {
  const box = el("div", "mc-sheet");
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-labelledby", "mc-sheet-title");
  box.setAttribute("data-part", "sheet");
  const panel = el("div", "mc-sheet-panel");
  const top = el("div", "mc-sheet-top");
  const h = el("h3", "mc-sheet-title", sh.title);
  h.setAttribute("id", "mc-sheet-title");
  top.appendChild(h);
  const close = () => {
    if (box.parentNode) box.parentNode.removeChild(box);
    if (returnTo && typeof returnTo.focus === "function") returnTo.focus();
  };
  const x = button("mc-btn mc-close", "Close", close);
  top.appendChild(x);
  panel.appendChild(top);
  panel.appendChild(mark(sh.cls, sh.rows[0][1]));
  panel.appendChild(blocks([{ type: "facts", rows: sh.rows.slice(1) }]));
  if (edit && typeof onEdit === "function") {
    const ed = el("div", "mc-edit");
    ed.appendChild(el("p", "mc-note", "Outreach"));
    const msg = el("p", "mc-edit-msg");
    msg.setAttribute("role", "status");
    for (const choice of V.OUTREACH_CHOICES) {
      const b = button("mc-btn mc-choice", V.outreachWord(choice), () => {
        Promise.resolve(onEdit(sh.key, choice)).then((m) => { msg.textContent = String(m || ""); },
          () => { msg.textContent = "Not saved."; });
      });
      b.setAttribute("aria-pressed", sh.outreach === choice ? "true" : "false");
      ed.appendChild(b);
    }
    ed.appendChild(msg);
    panel.appendChild(ed);
  }
  box.appendChild(panel);
  box.addEventListener("keydown", (e) => { if (e && e.key === "Escape") close(); });
  box.addEventListener("click", (e) => { if (e && e.target === box) close(); });
  root.appendChild(box);
  if (typeof x.focus === "function") x.focus();
  return box;
}

// Clears root and draws the whole page from the three responses.
export function render(root, data, opts) {
  const o = opts || {};
  doc = root.ownerDocument;
  const d = data || {};
  clear(root);
  if (o.setup) o.setup.hidden = true;

  if (d.main === undefined) {
    root.appendChild(header(null, o));
    const p = el("p", "mc-message", V.SENTENCES.loading);
    p.setAttribute("data-part", "message");
    root.appendChild(p);
    return;
  }
  const mm = V.mainModel(d.main);
  if (mm.kind === "setup") {
    root.appendChild(header(null, o));
    if (o.setup) o.setup.hidden = false;
    return;
  }
  if (mm.kind === "message") {
    root.appendChild(header(null, o));
    const p = el("p", "mc-message", mm.text);
    p.setAttribute("data-part", "message");
    root.appendChild(p);
    root.appendChild(footer(o));
    return;
  }

  const map = d.map === undefined || d.towns === undefined ? null : V.mapModel(d.map, d.towns);
  const state = { list: false };
  const openTown = (key, from) => {
    const sh = V.townSheet(key, map, d.towns);
    sheet(root, sh, mm.outreachEdit, o.onEdit, from);
  };

  root.appendChild(header(mm, o));
  const main = el("main", "mc-main");
  main.appendChild(headlineBox(mm.headline));
  main.appendChild(tileList(mm.tiles));
  main.appendChild(mapSection(map, state, openTown));
  // With no line at all the clear headline says it; no empty section.
  if (mm.needs.urgent.length || mm.needs.known.length) main.appendChild(needsSection(mm.needs));
  main.appendChild(detailsSection(V.detailsModel(d.main.body, map), o));
  root.appendChild(main);
  root.appendChild(footer(o));
}

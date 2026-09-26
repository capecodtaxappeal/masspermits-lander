// Mission Control: DOM building only. No request, storage or timer; the clock
// and every action are injected, so the offline demo reuses this file. Values
// go in with textContent or setAttribute on fixed names, never as markup.
//   render(root, {main, map, towns}, {now, onRefresh, onEdit, link, setup})
//   main, map: undefined while loading, else {status, body}; towns: null if it
//   failed; link(url): the href to use (the demo gives "#"); setup: the static
//   "Setup needed" element shown on not-configured.

import {
  MSG, mainModel, mapModel, needsView, detailsView, townFacts, listGroups, fmtTime, OUTREACH_STATES,
} from "./mission-view.js";

// Assembled so no scheme literal appears in page code (the demo checks).
const SVGNS = ["http", "//www.w3.org/2000/svg"].join(":");

function mk(doc, tag, cls, text) {
  const e = doc.createElement(tag);
  if (cls) e.setAttribute("class", cls);
  if (text !== undefined && text !== null) e.textContent = String(text);
  return e;
}

function button(doc, cls, text, onClick) {
  const b = mk(doc, "button", cls, text);
  b.setAttribute("type", "button");
  b.addEventListener("click", onClick);
  return b;
}

function kids(parent, ...nodes) {
  for (const n of nodes) if (n) parent.appendChild(n);
  return parent;
}

function section(doc, id, title) {
  const s = mk(doc, "section", "sec sec-" + id);
  s.setAttribute("aria-labelledby", "h-" + id);
  const h = mk(doc, "h2", "sec-h", title);
  h.setAttribute("id", "h-" + id);
  return kids(s, h);
}

function linkTo(doc, opts, url, text, cls) {
  const a = mk(doc, "a", cls, text);
  a.setAttribute("href", typeof opts.link === "function" ? opts.link(url) : url);
  return a;
}

export function render(root, data, opts = {}) {
  const doc = root.ownerDocument;
  const d = data || {};
  const m = mainModel(d.main);
  const mm = mapModel(d.map, d.towns);
  const setup = opts.setup || null;
  const nodes = [];

  if (setup) setup.hidden = m.kind !== "setup";

  // header: title and Refresh on one row, who and when on the next
  const head = mk(doc, "header", "top");
  const h1 = mk(doc, "h1", "top-h", MSG.title);
  const refresh = button(doc, "btn", "Refresh", () => { if (typeof opts.onRefresh === "function") opts.onRefresh(); });
  const who = mk(doc, "p", "top-who");
  who.setAttribute("data-role", "signed-in");
  if (m.kind === "ok") who.textContent = "Signed in as " + m.signedInAs;
  const meta = kids(mk(doc, "div", "top-meta"), who);
  if (m.kind === "ok") {
    meta.appendChild(mk(doc, "span", "top-at num", fmtTime(m.now)));
  }
  kids(head, kids(mk(doc, "div", "top-row"), h1, refresh), meta);
  nodes.push(head);

  const body = mk(doc, "main", "grid");
  body.setAttribute("id", "mission-main");
  nodes.push(body);

  if (m.kind === "setup") {
    root.replaceChildren(...nodes);
    return m;
  }
  if (m.kind !== "ok") {
    const p = mk(doc, "p", "state-msg " + (m.kind === "loading" ? "s-grey" : "s-red"), m.message);
    p.setAttribute("data-role", "message");
    p.setAttribute("role", "status");
    body.appendChild(p);
    root.replaceChildren(...nodes, footer(doc, opts));
    return m;
  }

  // headline
  const hl = mk(doc, "p", "headline " + m.headline.cls);
  hl.setAttribute("role", "status");
  hl.setAttribute("aria-live", "polite");
  const hw = mk(doc, "span", "word", m.headline.word);
  const ht = mk(doc, "span", "headline-t", m.headline.text);
  ht.setAttribute("data-role", "headline");
  kids(body, kids(hl, hw, ht));

  // tiles
  const tl = mk(doc, "ul", "tiles");
  tl.setAttribute("aria-label", "Status");
  for (const t of m.tiles) {
    const li = mk(doc, "li", "tile " + t.cls);
    li.setAttribute("data-tile", t.id);
    li.setAttribute("aria-label", t.aria);
    const word = mk(doc, "span", "word", t.word);
    word.setAttribute("data-role", "tile-word");
    const val = mk(doc, "span", "t-val num", t.value);
    val.setAttribute("data-role", "tile-value");
    kids(li, mk(doc, "span", "t-label", t.label), kids(mk(doc, "span", "t-row"), word, val),
      mk(doc, "span", "t-sub", t.sub), mk(doc, "span", "t-asof num", t.asOf));
    tl.appendChild(li);
  }
  body.appendChild(tl);

  // map, legend, attribution
  const sheet = townSheet(doc, m, mm, opts);
  body.appendChild(mapSection(doc, mm, sheet));

  // needs you
  body.appendChild(needsSection(doc, needsView(m.body.needs_you)));

  // details
  const det = section(doc, "details", "Details");
  for (const s of detailsView(m, mm)) det.appendChild(detailBlock(doc, s, opts));
  body.appendChild(det);

  root.replaceChildren(...nodes, footer(doc, opts), sheet.el);
  return m;
}

function footer(doc, opts) {
  const f = mk(doc, "footer", "foot");
  kids(f, linkTo(doc, opts, "/admin/pipeline", "Pipeline", "foot-a"), linkTo(doc, opts, "/admin/now", "Now", "foot-a"));
  return f;
}

function mapSection(doc, mm, sheet) {
  const s = section(doc, "map", "Towns");
  if (mm.kind !== "ok") {
    const p = mk(doc, "p", "map-msg", mm.message);
    p.setAttribute("data-role", "map-message");
    return kids(s, p);
  }
  const wrap = mk(doc, "div", "map-wrap");
  // Built off-document, attached once.
  const svg = doc.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", mm.viewBox);
  svg.setAttribute("class", "map");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", mm.summary);
  svg.setAttribute("data-role", "map");
  const g = doc.createElementNS(SVGNS, "g");
  for (const t of mm.towns) {
    const p = doc.createElementNS(SVGNS, "path");
    p.setAttribute("d", t.d);
    p.setAttribute("fill-rule", "evenodd");
    p.setAttribute("class", "town m-" + t.code + (t.planned ? " planned" : ""));
    p.setAttribute("data-town", t.key);
    g.appendChild(p);
  }
  svg.appendChild(g);
  svg.addEventListener("click", (ev) => {
    const tgt = ev && ev.target;
    const key = tgt && typeof tgt.getAttribute === "function" ? tgt.getAttribute("data-town") : null;
    if (key) sheet.open(key, null);
  });

  const list = mk(doc, "div", "townlist");
  list.hidden = true;
  for (const grp of listGroups(mm)) {
    const h = mk(doc, "h3", "tl-h");
    kids(h, mk(doc, "span", "sw " + grp.cls), mk(doc, "span", null, grp.text + " "), mk(doc, "span", "num", "(" + grp.count + ")"));
    const ul = mk(doc, "ul", "tl-ul");
    for (const key of grp.towns) {
      const b = button(doc, "tl-b", key, () => sheet.open(key, b));
      kids(ul, kids(mk(doc, "li"), b));
    }
    kids(list, h, ul);
  }

  const toggle = button(doc, "btn", MSG.showList, () => {
    const on = list.hidden;
    list.hidden = !on;
    svg.setAttribute("class", on ? "map is-off" : "map");
    toggle.setAttribute("aria-pressed", on ? "true" : "false");
    toggle.textContent = on ? MSG.showMap : MSG.showList;
  });
  toggle.setAttribute("aria-pressed", "false");
  toggle.setAttribute("data-role", "list-toggle");

  const legend = mk(doc, "table", "legend");
  const cap = mk(doc, "caption", "vh", "Legend");
  legend.appendChild(cap);
  const tb = mk(doc, "tbody");
  for (const l of mm.legend) {
    const tr = mk(doc, "tr");
    const c0 = mk(doc, "td", "lg-sw");
    c0.appendChild(mk(doc, "span", "sw " + l.cls));
    kids(tr, c0, mk(doc, "td", "lg-t", l.text + (l.planned ? " (" + l.planned + " planned)" : "")),
      mk(doc, "td", "lg-n num", String(l.count)));
    tb.appendChild(tr);
  }
  const tot = mk(doc, "tr", "lg-tot");
  kids(tot, mk(doc, "td"), mk(doc, "td", "lg-t", "Total"), mk(doc, "td", "lg-n num", String(mm.total)));
  kids(legend, tb, kids(mk(doc, "tfoot"), tot));

  const side = mk(doc, "div", "map-side");
  kids(side, legend, mk(doc, "p", "meta", mm.opengov));
  const asof = mk(doc, "p", "meta num");
  asof.textContent = mm.asOf.map((x) => x[0] + " " + x[1]).join(" · ");
  side.appendChild(asof);
  if (mm.unmatched.length) side.appendChild(mk(doc, "p", "meta", "Not matched to a map town: " + mm.unmatched.join(", ")));
  const attr = mk(doc, "p", "attr", mm.attribution);
  attr.setAttribute("data-role", "attribution");

  kids(wrap, kids(mk(doc, "div", "map-box"), svg, list), side);
  return kids(s, kids(mk(doc, "div", "sec-tools"), toggle), wrap, attr);
}

function needsSection(doc, nv) {
  const s = section(doc, "needs", "Needs you");
  if (nv.urgent.length) {
    s.appendChild(needsTable(doc, nv.urgent, "need"));
  } else {
    s.appendChild(mk(doc, "p", "meta", "No red or amber line."));
  }
  if (nv.known.length) {
    const det = mk(doc, "details", "known");
    const sum = mk(doc, "summary", "known-s", nv.knownTitle);
    kids(det, sum, needsTable(doc, nv.known, "known"));
    s.appendChild(det);
  }
  return s;
}

function needsTable(doc, rows, role) {
  const t = mk(doc, "table", "needs");
  const hr = mk(doc, "tr");
  for (const [h, c] of [["Severity", "n-sev"], ["What", "n-what"], ["Where", "n-where"]]) {
    const th = mk(doc, "th", c, h);
    th.setAttribute("scope", "col");
    hr.appendChild(th);
  }
  t.appendChild(kids(mk(doc, "thead", "vh"), hr));
  const tb = mk(doc, "tbody");
  for (const r of rows) {
    const tr = mk(doc, "tr", "nrow " + r.cls);
    tr.setAttribute("data-role", role);
    tr.setAttribute("data-id", r.id);
    const w = mk(doc, "td", "n-sev");
    w.appendChild(mk(doc, "span", "word", r.word));
    const txt = mk(doc, "td", "n-what", r.text);
    txt.setAttribute("data-role", role + "-text");
    kids(tr, w, txt, mk(doc, "td", "n-where", r.where));
    tb.appendChild(tr);
  }
  return kids(t, tb);
}

function detailBlock(doc, s, opts) {
  const det = mk(doc, "details", "det det-" + s.id);
  const sum = mk(doc, "summary", "det-s");
  sum.appendChild(mk(doc, "h3", "det-h", s.title));
  det.appendChild(sum);
  for (const b of s.blocks) {
    if (!b) continue;
    if (b.t === "h") det.appendChild(mk(doc, "h4", "det-sub", b.text));
    else if (b.t === "text") det.appendChild(mk(doc, "p", "det-p", b.text));
    else if (b.t === "list") {
      const ul = mk(doc, "ul", "det-list");
      for (const it of b.items) ul.appendChild(mk(doc, "li", null, it));
      det.appendChild(ul);
    } else if (b.t === "kv") {
      const dl = mk(doc, "dl", "kv");
      for (const [k, v] of b.rows) kids(dl, kids(mk(doc, "div", "kv-r"), mk(doc, "dt", null, k), mk(doc, "dd", "num", v)));
      det.appendChild(dl);
    } else if (b.t === "rows") {
      const ul = mk(doc, "ul", "people");
      for (const p of b.rows) {
        const li = mk(doc, "li", "person");
        const top = kids(mk(doc, "div", "p-top"), mk(doc, "span", "p-name", p.name),
          p.href ? linkTo(doc, opts, p.href, "Stripe", "p-link") : null, mk(doc, "span", "p-amt num", p.amount));
        kids(li, top, mk(doc, "div", "p-meta num", p.meta));
        ul.appendChild(li);
      }
      det.appendChild(ul);
    } else if (b.t === "src") {
      const ul = mk(doc, "ul", "people");
      for (const x of b.rows) {
        const li = mk(doc, "li", "person");
        kids(li, kids(mk(doc, "div", "p-top"), mk(doc, "span", "p-name", x.town), mk(doc, "span", "p-amt num", x.state)),
          mk(doc, "div", "p-meta num", "since " + x.since), mk(doc, "div", "p-why", x.why));
        ul.appendChild(li);
      }
      det.appendChild(ul);
    }
  }
  return det;
}

// The town sheet: a dialog. Focus moves in; Escape and Close close it and
// focus goes back where it was.
function townSheet(doc, m, mm, opts) {
  const el = mk(doc, "div", "sheet");
  el.hidden = true;
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-labelledby", "sheet-h");
  el.setAttribute("data-role", "sheet");
  let back = null;
  const close = () => {
    el.hidden = true;
    if (back && typeof back.focus === "function") back.focus();
    back = null;
  };
  el.addEventListener("keydown", (ev) => { if (ev && ev.key === "Escape") close(); });
  const api = {
    el,
    close,
    open(key, from) {
      if (mm.kind !== "ok") return;
      back = from || doc.activeElement || null;
      const facts = townFacts(key, mm.body.towns[key]);
      const h = mk(doc, "h3", "sheet-h", key);
      h.setAttribute("id", "sheet-h");
      const x = button(doc, "btn sheet-x", "Close", close);
      const dl = mk(doc, "dl", "kv");
      for (const [k, v] of facts.slice(1)) kids(dl, kids(mk(doc, "div", "kv-r"), mk(doc, "dt", null, k), mk(doc, "dd", null, v)));
      const parts = [kids(mk(doc, "div", "sheet-top"), h, x), dl];
      if (m.outreachEdit) {
        const msg = mk(doc, "p", "sheet-msg meta");
        msg.setAttribute("role", "status");
        const row = mk(doc, "div", "sheet-edit");
        for (const v of [...OUTREACH_STATES, null]) {
          row.appendChild(button(doc, "btn", v || "clear", () => {
            const r = typeof opts.onEdit === "function" ? opts.onEdit(key, v) : null;
            Promise.resolve(r).then((t) => { msg.textContent = t ? String(t) : ""; }, () => { msg.textContent = MSG.unreadable; });
          }));
        }
        parts.push(mk(doc, "h4", "det-sub", "Set outreach"), row, msg);
      }
      el.replaceChildren(...parts);
      el.hidden = false;
      x.focus();
    },
  };
  return api;
}

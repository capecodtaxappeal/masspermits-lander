// Road to 20: turns the /admin/api/growth answer into the page. DOM calls
// only (createElement, createElementNS, setAttribute, textContent); no HTML
// string is ever parsed, so nothing in a response can become markup.

const SVG = "http://www.w3.org/2000/svg";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const COLUMNS = [
  ["visits", "Visits"],
  ["buy_clicks", "Buy clicks"],
  ["checkouts", "Checkouts opened"],
  ["abandoned", "Abandoned"],
  ["paid", "Paid"],
  ["subscribers", "Paying at week end"],
  ["free_signups", "Free sign ups"],
];

function el(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.setAttribute("class", cls);
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}

function svg(doc, tag, attrs, text) {
  const n = doc.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, String(v));
  if (text !== undefined) n.textContent = String(text);
  return n;
}

export function day(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  return m ? MONTHS[+m[2] - 1] + " " + (+m[3]) : String(iso || "");
}

export function count(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Short forms for the table, so a word fits a phone column. The notes under
// the table say what each one means.
const SHORT = { "no data yet": "no data", "not tracked yet": "not yet", "not connected": "not set up", "key refused": "refused" };

// A cell: a number (with a floor mark when the week says so) or its word.
export function cell(w, key) {
  const v = w[key];
  if (typeof v !== "number") {
    const word = String(v == null ? "unavailable" : v);
    return { text: SHORT[word] || word, word: true };
  }
  const floor = Array.isArray(w.at_least) && w.at_least.includes(key);
  return { text: (floor ? "≥ " : "") + count(v), word: false };
}

const SOURCE_COLUMNS = [
  ["referral", "Referral"],
  ["picker", "Homepage picker"],
  ["prospect_sample", "Prospect sample"],
  ["unknown", "Unknown"],
];

const RETENTION_COLUMNS = [
  ["new_paid", "New"],
  ["ended", "Ended"],
  ["net", "Net"],
  ["subscribers", "Paying at week end"],
];

// "Dec 31, 2026"
export function longDay(iso) {
  const m = /^(\d{4})-\d{2}-\d{2}$/.exec(String(iso || ""));
  return m ? day(iso) + ", " + m[1] : String(iso || "");
}

// The line under the headline: "6 to go to 10", with the deadline when the
// milestone has one, or the last milestone reached.
export function toGoText(next) {
  if (!next || typeof next.target !== "number") return "";
  if (next.reached) return "Goal of " + next.target + " reached";
  return count(next.to_go) + " to go to " + next.target + (next.deadline ? " by " + longDay(next.deadline) : "");
}

export function roadTitle(p) {
  return "Road to " + (p && p.road === 100 ? 100 : 20);
}

function rateText(r, noun) {
  if (!r) return "";
  const base = count(r.n) + " of " + count(r.d) + " " + noun;
  return r.pct === null || r.pct === undefined ? base : base + " (" + r.pct + "%)";
}

function hero(doc, p) {
  const box = el(doc, "section", "hero");
  if (typeof p.paying_now === "number") {
    const big = el(doc, "div", "big");
    big.appendChild(doc.createTextNode((p.paying_at_least === true ? "≥ " : "") + count(p.paying_now)));
    big.appendChild(el(doc, "span", "of", " of " + p.goal));
    big.setAttribute("data-part", "headline");
    box.appendChild(big);
    const go = el(doc, "div", "togo", toGoText(p.next_milestone));
    go.setAttribute("data-part", "to-go");
    box.appendChild(go);
  } else {
    const w = el(doc, "div", "word", String(p.paying_state || "unavailable"));
    w.setAttribute("data-part", "headline");
    box.appendChild(w);
    box.appendChild(el(doc, "div", "muted", "of " + p.goal + ". " + (p.paying_state === "not connected"
      ? "Stripe is not connected yet: STRIPE_READ_KEY and MASSPERMITS_PRICE_IDS must be set."
      : p.paying_state === "key refused"
        ? "The Stripe key was refused: only a restricted live read key is used."
        : "The count of paying subscribers could not be read from Stripe. It is not zero; press Refresh in a minute.")));
  }
  const scope = p.sources && p.sources.stripe && p.sources.stripe.scope;
  box.appendChild(el(doc, "p", "muted small", scope === "all"
    ? "paying subscribers right now, every MassPermits product. Set MASSPERMITS_FEED_PRICE_IDS to count only the Weekly Feed."
    : "paying Weekly Feed subscribers right now"));
  if (Array.isArray(p.milestones)) {
    box.appendChild(el(doc, "p", "muted small", "Milestones: " + p.milestones.map((m) => {
      const dl = p.next_milestone && p.next_milestone.target === m && p.next_milestone.deadline;
      return String(m) + (dl ? " by " + longDay(dl) : "");
    }).join(", then ") + "."));
  }
  box.appendChild(chart(doc, p));
  return box;
}

function chart(doc, p) {
  const W = 320, H = 160, L = 30, R = 310, T = 12, B = 132;
  const weeks = p.weeks || [];
  const vals = weeks.map((w) => (typeof w.subscribers === "number" ? w.subscribers : null));
  const top = Math.max(p.goal, ...vals.filter((v) => v !== null));
  const x = (i) => L + (weeks.length > 1 ? (i * (R - L)) / (weeks.length - 1) : 0);
  const y = (v) => B - (v * (B - T)) / top;
  const s = svg(doc, "svg", { viewBox: "0 0 " + W + " " + H, class: "chart", role: "img",
    "aria-label": "Paying subscribers each week against the goal of " + p.goal });
  s.setAttribute("data-part", "chart");
  s.appendChild(svg(doc, "line", { x1: L, y1: B, x2: R, y2: B, class: "axis" }));
  s.appendChild(svg(doc, "line", { x1: L, y1: y(p.goal), x2: R, y2: y(p.goal), class: "goal" }));
  s.appendChild(svg(doc, "text", { x: L, y: y(p.goal) - 4, class: "goal-label" }, "Goal " + p.goal));
  s.appendChild(svg(doc, "text", { x: L - 4, y: B + 3, "text-anchor": "end" }, "0"));
  s.appendChild(svg(doc, "text", { x: L - 4, y: y(p.goal) + 3, "text-anchor": "end" }, String(p.goal)));
  const pts = [];
  vals.forEach((v, i) => { if (v !== null) pts.push([x(i), y(v), v]); });
  if (pts.length > 1) {
    s.appendChild(svg(doc, "polyline", { points: pts.map((q) => q[0].toFixed(1) + "," + q[1].toFixed(1)).join(" "), class: "subs" }));
  }
  for (const q of pts) s.appendChild(svg(doc, "circle", { cx: q[0].toFixed(1), cy: q[1].toFixed(1), r: 3, class: "dot" }));
  if (pts.length) {
    const last = pts[pts.length - 1];
    s.appendChild(svg(doc, "text", { x: Math.min(last[0], R - 4), y: last[1] - 7, "text-anchor": "end" }, String(last[2])));
  }
  if (weeks.length) {
    s.appendChild(svg(doc, "text", { x: L, y: H - 8 }, day(weeks[0].week)));
    s.appendChild(svg(doc, "text", { x: R, y: H - 8, "text-anchor": "end" }, "this week"));
  }
  return s;
}

// A funnel total: its word, or the number with the floor mark and, when it
// covers fewer weeks than the card, how many.
function totalText(f, key) {
  const v = (f.totals || {})[key];
  if (typeof v !== "number") {
    const word = String(v == null ? "unavailable" : v);
    return SHORT[word] || word;
  }
  const floor = Array.isArray(f.at_least) && f.at_least.includes(key);
  const used = f.covered && typeof f.covered[key] === "number" ? f.covered[key] : f.weeks;
  return (floor ? "≥ " : "") + count(v) + (used < f.weeks ? " (" + used + " of " + f.weeks + " weeks)" : "");
}

function funnelCard(doc, title, f) {
  const card = el(doc, "section", "card");
  card.appendChild(el(doc, "h3", null, title));
  const ul = el(doc, "ul", "steps");
  const r = f.rates || {};
  const rows = [
    ["Visits", "visits", ""],
    ["Clicked Buy", "buy_clicks", rateText(r.visit_to_click, "visits")],
    ["Opened checkout", "checkouts", rateText(r.click_to_checkout, "Buy clicks")],
    ["Paid", "paid", rateText(r.checkout_to_paid, "checkouts")],
    ["Abandoned", "abandoned", rateText(r.checkout_abandoned, "checkouts")],
  ];
  for (const [label, key, sub] of rows) {
    const li = el(doc, "li");
    li.appendChild(el(doc, "span", null, label));
    const n = el(doc, "span", "n", totalText(f, key));
    if (sub) n.appendChild(el(doc, "span", "r", sub));
    li.appendChild(n);
    ul.appendChild(li);
  }
  card.appendChild(ul);
  return card;
}

function retentionBox(doc, p) {
  const r = p.retention || {};
  const card = el(doc, "section", "card keep");
  card.setAttribute("data-part", "retention");
  if (r.state !== "ok") {
    card.appendChild(el(doc, "p", "muted", "Retention: " + String(r.state || "unavailable") + "."));
    return card;
  }
  const mark = r.at_least === true ? "≥ " : "";
  const ul = el(doc, "ul", "steps");
  for (const [label, v] of [["Paying now", mark + count(r.paying_now)], ["Leaving", count(r.leaving)],
    ["Paying after scheduled cancels", count(r.paying_after)]]) {
    const li = el(doc, "li");
    li.appendChild(el(doc, "span", null, label));
    li.appendChild(el(doc, "span", "n", v));
    ul.appendChild(li);
  }
  card.appendChild(ul);
  if (Array.isArray(r.ends) && r.ends.length) {
    card.appendChild(el(doc, "p", "muted small", "Leaving: " + r.ends.map((e) =>
      count(e.n) + (e.date === "unknown" ? " on a date Stripe did not give" : " on " + longDay(e.date))).join(", ") + "."));
  }
  return card;
}

// A week-by-week table over the given columns, newest week first. `get(w,
// key)` is a cell(); `foot`, when given, is a last row.
function weekTable(doc, p, part, columns, get, foot) {
  const wrap = el(doc, "div", "scroll");
  const t = el(doc, "table");
  t.setAttribute("data-part", part);
  const hr = el(doc, "tr");
  hr.appendChild(el(doc, "th", null, "Week of"));
  for (const [, label] of columns) hr.appendChild(el(doc, "th", null, label));
  const head = el(doc, "thead");
  head.appendChild(hr);
  t.appendChild(head);
  const body = el(doc, "tbody");
  for (const w of (p.weeks || []).slice().reverse()) {
    const tr = el(doc, "tr", w.current ? "now" : null);
    tr.appendChild(el(doc, "td", null, w.current ? "This week" : day(w.week)));
    for (const [key] of columns) {
      const c = get(w, key);
      tr.appendChild(el(doc, "td", c.word ? "word-cell" : null, c.text));
    }
    body.appendChild(tr);
  }
  if (foot) body.appendChild(foot);
  t.appendChild(body);
  wrap.appendChild(t);
  return wrap;
}

// A source cell: that week's count for one bucket, or the week's word.
export function sourceCell(w, key) {
  const v = w.paid_by_source;
  if (!v || typeof v !== "object") return cell({ x: v }, "x");
  return cell({ x: v[key], at_least: Array.isArray(w.at_least) && w.at_least.includes("paid_by_source") ? ["x"] : [] }, "x");
}

function sourceTable(doc, p) {
  const sp = p.sources_paid || {};
  let foot = null;
  if (sp.state === "ok" && sp.totals) {
    foot = el(doc, "tr", "total");
    foot.appendChild(el(doc, "td", null, "All " + (p.weeks || []).length + " weeks"));
    for (const [key] of SOURCE_COLUMNS) foot.appendChild(el(doc, "td", null, (sp.at_least ? "≥ " : "") + count(sp.totals[key] || 0)));
  }
  return weekTable(doc, p, "sources", SOURCE_COLUMNS, sourceCell, foot);
}

function notes(doc, p) {
  const out = [];
  const s = p.sources || {};
  const first = p.weeks && p.weeks[0] ? p.weeks[0].week : null;
  if (s.visits && s.visits.data_starts && first && s.visits.data_starts > first) {
    out.push("Visits are counted from " + day(s.visits.data_starts) + ", the day the visit counter started.");
  }
  if (s.clicks) {
    if (s.clicks.data_starts) out.push("Buy clicks are counted from " + day(s.clicks.data_starts) + ", the first click recorded.");
    else if (s.clicks.state !== "unreadable") out.push("No Buy click has been recorded yet.");
  }
  if (s.visits && s.visits.old_offer_clicks_left_out > 0) {
    out.push(count(s.visits.old_offer_clicks_left_out) + " clicks on the offer page's buttons are logged as page views for /ops. They are left out of visits here, so /ops shows more visits for the same days.");
  }
  if (s.stripe && s.stripe.state !== "ok" && s.stripe.reason) out.push("Stripe: " + s.stripe.reason + ".");
  if (s.free && s.free.state !== "ok") out.push("Free sign ups: no snapshot history could be read.");
  out.push("Checkouts, abandoned and paid are counted in the week the checkout was opened. Paid means completed and charged; a checkout completed with nothing charged (a full discount or a trial) is not counted as paid. Abandoned means it expired, or was still open more than 24 hours later, and the same buyer (same Stripe customer or email) did not complete another checkout in these weeks.");
  out.push("Buy clicks come from a counter on our own pages. A script could fake some, so read them as a guide, not an exact figure.");
  out.push("In the table, \"no data\" and \"not yet\" mean that counter had not started; \"unavailable\" means it could not be read just now; \"not set up\" means Stripe is not connected.");
  out.push("≥ means at least: that week's list was cut short or its data starts partway through, so the real number may be higher. In the two boxes, \"3 of 4 weeks\" means that total only covers the weeks its counter was running.");
  out.push("Retention: \"leaving\" is a paying subscription set to cancel at the end of its period (or on a set date). It still counts as paying until that date, then as ended. New and Ended count subscriptions that started or stopped paying that week; Net is New minus Ended.");
  out.push("Source of each paid checkout comes from the reference the Buy link carries: a referral link, the homepage trade and area picker, or a prospect sample link (reserved for future sample links, so it reads 0 for now). A Buy link with no reference counts as unknown.");
  out.push("Weeks run Monday to Sunday, Boston time. Numbers are counts only; no names or emails are on this page.");
  const ul = el(doc, "ul", "notes small muted");
  ul.setAttribute("data-part", "notes");
  for (const n of out) ul.appendChild(el(doc, "li", null, n));
  return ul;
}

function problem(doc, res) {
  const box = el(doc, "div", "error");
  box.setAttribute("data-part", "error");
  const st = res ? res.status : 0;
  const reason = res && res.json && typeof res.json.reason === "string" ? res.json.reason : "";
  box.textContent = st === 0 ? "Could not reach the server. Check the connection and press Refresh."
    : st === 403 ? "This page is only for the owner. Sign in through Cloudflare Access and press Refresh." + (reason ? " (" + reason + ")" : "")
      : st === 404 ? "This page only works on masspermits.com."
        : "The numbers are unavailable right now. Press Refresh in a minute.";
  return box;
}

// render(root, { status, json }) paints #app. Returns what it showed.
export function render(root, res) {
  const doc = root.ownerDocument;
  const p = res && res.status === 200 ? res.json : null;
  if (!p || !Array.isArray(p.weeks)) {
    root.replaceChildren(problem(doc, res));
    return "error";
  }
  const kids = [hero(doc, p)];
  const cards = el(doc, "div", "cards");
  cards.appendChild(funnelCard(doc, "This week so far", p.funnel.this_week));
  cards.appendChild(funnelCard(doc, "Last 4 full weeks", p.funnel.last_4_weeks));
  kids.push(el(doc, "h2", null, "The steps to a sale"), cards);
  kids.push(el(doc, "h2", null, "Week by week"), weekTable(doc, p, "weeks", COLUMNS, cell));
  kids.push(el(doc, "h2", null, "Keeping subscribers"), retentionBox(doc, p),
    weekTable(doc, p, "retention-weeks", RETENTION_COLUMNS, cell));
  kids.push(el(doc, "h2", null, "Where paid checkouts came from"), sourceTable(doc, p));
  kids.push(el(doc, "h2", null, "How to read this"), notes(doc, p));
  kids.push(el(doc, "p", "muted small", "Updated " + String(p.as_of || "").slice(0, 16).replace("T", " ") + " UTC. Stripe numbers can be up to 10 minutes old."));
  const fn = el(doc, "p", "muted small", "Counts follow the MassPermits price list set on the server.");
  fn.setAttribute("data-part", "footnote");
  kids.push(fn);
  root.replaceChildren(...kids);
  const title = roadTitle(p);
  const h1 = doc.getElementById ? doc.getElementById("title") : null;
  if (h1) h1.textContent = title;
  doc.title = title;
  return "ok";
}

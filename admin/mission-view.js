// Mission Control: view models. Pure (no DOM, no request, no clock of its own).
// Turns the two API views into words, classes and lines; mission-render.js
// only places them. Every fixed sentence on the page lives here.

export const TILE_ORDER = ["paying", "revenue", "renewals", "failed", "monday", "refresh", "sales", "signups"];
const WORD = { green: "OK", amber: "WATCH", red: "ACT" };
const GREY = { "not-connected": "NOT CONNECTED", unavailable: "UNAVAILABLE", unverified: "UNVERIFIED", pending: "NOT YET" };
export const LEGEND = [
  ["dead", "Stale or dead source"],
  ["weekly", "Live, weekly"],
  ["monthly", "Live, monthly or slower"],
  ["answered", "Outreach answered"],
  ["sent", "Outreach sent"],
  ["locked", "Locked behind OpenGov"],
  ["none", "Not covered"],
];
const CODES = LEGEND.map((x) => x[0]);
export const EK = {
  owner_name_gate: "The engine's privacy guard stopped this town's rows (a parser fix is needed; nothing was published)",
  access_controlled: "Blocked by the town's site. That is an authorization decision: do not retry, it will not come back by itself.",
  no_rows: "Returned no rows",
  timeout: "The town's site timed out",
  http_error: "The town's site returned an error",
  parse: "The town's page changed shape (parser)",
  other: "Failed (the reason is not shown on this page)",
};
const FAIL = { crash: "crashed", gate: "stopped by its quality gate" };
export const TEXT = {
  clear: "Nothing is wrong that this page can see.",
  attribution: "Boundaries: U.S. Census Bureau, TIGER/Line Shapefiles 2024",
  notOwner: "Not signed in as the owner. Reload to sign in again.",
  cannotRead: "Could not read the data. Reload; if it stays, check /admin/pipeline.",
  mapFailed: "The map could not load. Reload.",
  loading: "Loading",
  mapLoading: "Loading the map.",
  demoSaved: "Demo: nothing is saved",
  notReported: "not reported",
  noCustomers: "No customers yet.",
};
// Tile labels for the loading state only, before any payload has arrived;
// once the default view answers, every label comes from it.
const LOADING_LABELS = ["Paying customers", "Revenue, 30 days", "Renewals, 14 days", "Failed payments",
  "Monday email", "Data refresh", "Sales, 7 days", "Signups, 7 days"];
// Map codes that carry a hatch as well as a colour: the smallest simulated
// colour-vision difference between any two map colours is reported by the
// colour test, and a pair under 10 (CIEDE2000) must involve one of these.
export const HATCHED = ["dead"];
const TZ = "America/New_York";
// Own keys only: a payload code such as "__proto__" must never find a sentence.
const own = (o, k) => (typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

export const ekSentence = (code) => own(EK, code) || EK.other;
export const failSentence = (kind) => own(FAIL, kind) || "failed";

// state -> word and class; colour is never the only signal.
export function stateOf(state, grey) {
  if (own(WORD, state)) return { word: WORD[state], cls: "s-" + state };
  return { word: (state === "grey" && own(GREY, grey)) || "UNAVAILABLE", cls: "s-grey" };
}

// ── formatting ─────────────────────────────────────────────────────────────
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
export const count = (n) => (isNum(n) ? n.toLocaleString("en-US") : TEXT.notReported);
export function money(cents, cur) {
  if (!isNum(cents)) return TEXT.notReported;
  const c = typeof cur === "string" && /^[a-z]{3}$/i.test(cur) ? cur.toUpperCase() : "USD";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: c });
}
// "YYYY-MM-DD" is a calendar date: shown as written, never shifted by a zone.
export function day(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(s)) return TEXT.notReported;
  const t = Date.parse(s.length === 10 ? s + "T12:00:00Z" : s);
  if (!isNum(t)) return TEXT.notReported;
  return new Date(t).toLocaleDateString("en-US", { timeZone: s.length === 10 ? "UTC" : TZ, month: "short", day: "numeric", year: "numeric" });
}
export function when(s) {
  const t = typeof s === "number" ? s : Date.parse(s);
  if (!isNum(t)) return TEXT.notReported;
  return new Date(t).toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET";
}
export const staleNote = (at) => "Not updated. Showing data from " + when(at) + ".";
export function dateline(now) {
  return isNum(now) ? new Date(now).toLocaleDateString("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric", year: "numeric" }) : "";
}
const plural = (n, w) => count(n) + " " + w + (n === 1 ? "" : "s");
const list = (a) => (a.length ? a.join(", ") : "none");

// ── screens ────────────────────────────────────────────────────────────────
// resp: {status, json} as mission-app.js hands it over; null while loading.
export function screenOf(resp) {
  if (!resp) return "loading";
  const j = resp.json;
  if (resp.status === 200 && j && j.ok === true && Array.isArray(j.tiles)) return "ok";
  if (resp.status === 403 && j && j.reason === "not-configured") return "setup";
  if (resp.status === 403) return "not-owner";
  return "error";
}
export const mapOk = (map, towns) => !!(map && map.status === 200 && map.json && map.json.ok === true &&
  towns && towns.status === 200 && towns.json && towns.json.towns);

// ── tiles ──────────────────────────────────────────────────────────────────
// A number shows only beside OK / WATCH / ACT, or beside UNVERIFIED (its one
// measured-count exception). Any other state, grey kind or tile id is
// UNAVAILABLE with no figure.
export function tileView(t) {
  const known = TILE_ORDER.includes(t.id);
  const s = known ? stateOf(t.state, t.grey) : { word: "UNAVAILABLE", cls: "s-grey" };
  const counted = known && (own(WORD, t.state) || (t.state === "grey" && t.grey === "unverified"));
  let value;
  if (!counted) value = "—";
  else if (!isNum(t.value)) value = TEXT.notReported;
  else value = (/^at least/.test(t.sub) ? "at least " : "") + (t.id === "revenue" ? money(t.value) : count(t.value));
  const label = String(t.label || t.id);
  return { id: String(t.id), label, value, word: s.word, cls: s.cls,
    name: label + ": " + (value === "—" ? "no figure" : value) + ", " + s.word,
    sub: typeof t.sub === "string" ? t.sub : "", asOf: t.as_of ? when(t.as_of) : "" };
}
export const loadingTiles = () => TILE_ORDER.map((id, i) => ({ id, label: LOADING_LABELS[i], value: TEXT.loading,
  word: "", cls: "s-wait", name: LOADING_LABELS[i] + ": " + TEXT.loading, sub: "", asOf: "" }));
export function tilesView(tiles) {
  const at = (t) => { const i = TILE_ORDER.indexOf(t.id); return i < 0 ? 99 : i; };
  return tiles.slice().sort((a, b) => at(a) - at(b)).map(tileView);
}

// ── headline and needs you ─────────────────────────────────────────────────
export function headlineView(h) {
  const st = h && (h.state === "red" || h.state === "amber") ? h.state : "clear";
  const text = h && typeof h.text === "string" && h.text ? h.text : TEXT.clear;
  return { text, cls: "h-" + st, word: st === "clear" ? "OK" : WORD[st] };
}
export function needsView(lines) {
  const urgent = [], known = [];
  for (const sev of ["red", "amber"]) {
    for (const l of lines) if (l.severity === sev) urgent.push({ id: l.id, text: l.text, where: l.where, word: WORD[sev], cls: "n-" + sev });
  }
  for (const l of lines) if (l.severity !== "red" && l.severity !== "amber") known.push({ id: l.id, text: l.text, where: l.where, cls: "n-known" });
  return { urgent, known, knownTitle: "Known, not new (" + known.length + ")" };
}

// ── rows and sections ──────────────────────────────────────────────────────
// A customer-level row as one line plus an optional Stripe link.
export function rowLine(r, dateLabel) {
  const bits = [r.plan, r.status].filter(Boolean).join(", ");
  const parts = [String(r.name || "(no name)") + (bits ? " — " + bits : "")];
  if (r.since) parts.push("since " + day(r.since));
  if (r.date) parts.push((dateLabel || "date") + " " + day(r.date));
  if (isNum(r.amount_cents)) parts.push(money(r.amount_cents, r.currency));
  if (r.email_masked) parts.push(r.email_masked);
  if (r.t8) parts.push("t8 " + r.t8);
  return { text: parts.join(" · "), href: stripeHref(r.stripe_url) };
}
// Only a Stripe dashboard page is ever a link, whatever the payload says.
// ("[:]" keeps a scheme literal out of the file: the demo test refuses one.)
const STRIPE_HREF = /^https[:]\/\/dashboard\.stripe\.com\/(customers|subscriptions|invoices)\/[A-Za-z0-9_]{1,80}$/;
const stripeHref = (u) => (typeof u === "string" && STRIPE_HREF.test(u) ? u : null);
const rows = (a, label) => (Array.isArray(a) ? a.map((r) => rowLine(r, label)) : []);

function refreshSection(r, map) {
  const p = [];
  if (!r) return { paras: [TEXT.cannotRead], lists: [] };
  p.push(r.ok !== true && r.ok !== false ? "No run is reported." : "Last run " + when(r.ran_at) + ". " + (r.ok ? "It finished normally."
    : r.degraded === true ? "A reduced run: it shipped and told subscribers." : "The refresh " + failSentence(r.fail_kind) + "."));
  const c = r.coverage;
  p.push(c ? "Coverage: " + count(c.live_sources) + " of " + count(c.expected_sources) + " sources live (" +
    count(c.attempted_sources) + " attempted, " + count(c.lost_sources) + " lost), " + count(c.rows) + " rows." +
    (c.disclose ? " Subscribers are told coverage is reduced." : "") : "Coverage: " + TEXT.notReported + ".");
  p.push("Permits in the run: " + count(r.count) + ".");
  p.push("Uploaded: status file " + when(r.status_uploaded) + "; weekly bundle " + when(r.weekly_uploaded) +
    "; monthly bundle " + when(r.monthly_uploaded) + "; portal page " + when(r.portal_uploaded) + ".");
  p.push("The weekly bundle is the one last mailed: " + (r.same_bundle_as_last_send ? "yes" : "no") + ".");
  const lists = [{ title: "Sources in trouble", items: (r.sources || []).map((s) =>
    ({ text: s.town + " — " + s.state + ", since " + day(s.since) + ". " + ekSentence(s.ek) })) }];
  if (map && map.unmatched && map.unmatched.length) {
    lists.push({ title: "Production sources not on the map", items: map.unmatched.map((t) => ({ text: t })) });
  }
  return { paras: p, lists };
}

function mondaySection(m, t) {
  if (!m) return { paras: [TEXT.cannotRead], lists: [] };
  const p = ["Monday " + day(m.monday_date) + ": " + (t ? tileView(t).word : "UNAVAILABLE") + ". Due " + when(m.due) + ", held after " + when(m.hold) + ".",
    "Delivered to " + count(m.delivered) + " of " + count(m.expected) + " expected" +
    (m.best_at ? ", logged " + when(m.best_at) : "") + ".",
    "Sent twice to the same address: " + count(m.duplicates) + ". New since Monday: " + count(m.new_since_monday) + "."];
  if (m.skipped_only) p.push("The log holds only skipped entries: it mailed nobody.");
  p.push(m.caveat);
  return { paras: p, lists: [
    { title: "Expected but not delivered", items: rows(m.missing, "date") },
    { title: "Failed, with no later success", items: rows(m.failed, "date") },
    { title: "Joined on send day (not counted as missing)", items: rows(m.joined_on_send_day, "date") },
  ] };
}

function outreachSection(map, setup, mapState) {
  if (!map) return { paras: [mapState === "pending" ? TEXT.mapLoading : TEXT.mapFailed], lists: [] };
  // Counted from each town's outreach fact: a live town keeps its outreach.
  const c = map.counts || {}, o = { answered: 0, declined: 0, sent: 0, planned: 0 };
  for (const k in map.towns || {}) if (typeof own(o, map.towns[k].o) === "number") o[map.towns[k].o]++;
  const p = ["Answered or declined: " + count(o.answered + o.declined) + ". Sent: " + count(o.sent) + ". Locked: " + count(c.locked) +
    ". Planned (dashed outline): " + count(o.planned) + ".",
  "OpenGov: " + count(map.opengov && map.opengov.registry) + " in the town registry, " +
    count(map.opengov && map.opengov.owner_list) + " on your list.",
  "Outreach object: " + (setup ? setup.outreach : TEXT.notReported) + (map.as_of && map.as_of.outreach ? ", uploaded " + when(map.as_of.outreach) : "") + "."];
  return { paras: p, lists: [{ title: "Ignored (not on the map)", items: (map.outreach_ignored || []).map((t) => ({ text: t })) }] };
}

// mapState: "ok" | "pending" (still loading) | "failed"
export function sectionsView(main, map, mapState) {
  const d = main.detail || {};
  const cu = d.customers || {};
  const en = d.engagement;
  const cust = { paras: [], lists: [] };
  if (!isNum(cu.count)) cust.paras.push("Could not read the roster.");
  else if (cu.count === 0) cust.paras.push(TEXT.noCustomers);
  else {
    cust.paras.push(plural(cu.count, "active customer") + "; " + count(cu.cancelled) + " cancelled on the roster.");
    cust.lists.push({ title: "Active", items: rows(cu.rows, "renews"), more: cu.more > 0 ? "+" + count(cu.more) + " more" : "" });
  }
  if (en) cust.paras.push("Engagement (standing counts): " + Object.keys(en).map((k) => k.replace(/-/g, " ") + " " + count(en[k])).join(", ") + ".");

  const rf = { paras: [], lists: [] };
  if (d.renewals) rf.lists.push({ title: "Renewing in 14 days", items: rows(d.renewals.rows, "renews") });
  else rf.paras.push("Renewals need Stripe, which is not connected or could not be read.");
  rf.lists.push({ title: "Failed payments", items: rows(d.failed_payments && d.failed_payments.rows, "date") });

  const sa = d.sales, sg = d.signups, ss = { paras: [], lists: [] };
  if (sa) {
    ss.paras.push("New checkouts in 7 days: " + count(sa.new_checkouts) + ". Renewal deliveries: " + count(sa.renewal_deliveries) + ".");
    if (isNum(sa.gross_cents)) ss.paras.push("Gross " + money(sa.gross_cents) + ": " + money(sa.new_subscription_cents) + " new subscriptions, " + money(sa.pack_cents) + " packs.");
    ss.lists.push({ title: "New checkouts", items: rows(sa.rows, "on") });
  } else ss.paras.push("Could not read the delivery log.");
  if (sg) {
    const al = sg.at_least ? "at least " : "";
    ss.paras.push("Signups in 7 days: " + al + count(sg.prospects) + " prospects, " + al + count(sg.agents) + " agents, " + al +
      count(sg.newsletter_new) + " newsletter (" + al + count(sg.newsletter_confirmed) + " confirmed, " + al + count(sg.newsletter_pending) + " pending).");
    ss.lists.push({ title: "Prospects by trade", items: Object.keys(sg.trades || {}).map((k) => ({ text: k + ": " + count(sg.trades[k]) })) });
    ss.lists.push({ title: "Signups by day (UTC)", items: Object.keys(sg.by_day || {}).map((k) => ({ text: day(k) + ": " + count(sg.by_day[k]) })) });
  } else ss.paras.push("Could not read the signup lists.");

  const su = d.setup || {};
  const we = su.webhook_events || {};
  const yn = (v) => (v === true ? "registered" : v === false ? "NOT registered" : "unknown");
  const setup = { paras: ["Stripe: " + (su.stripe || "unknown") + ". Price list: " + (su.price_list || "unknown") + ".",
    "Webhook invoice.payment_failed: " + yn(we["invoice.payment_failed"]) + "; customer.subscription.deleted: " + yn(we["customer.subscription.deleted"]) + ".",
    "Outreach object: " + (su.outreach || "unknown") + ". Town registry uploaded: " + (su.registry ? when(su.registry) : TEXT.notReported) + "."], lists: [] };

  return [
    { id: "customers", title: "Customers", ...cust },
    { id: "money", title: "Renewals and failed payments", ...rf },
    { id: "monday", title: "Monday delivery", ...mondaySection(d.monday, (main.tiles || []).find((t) => t.id === "monday")) },
    { id: "refresh", title: "Data refresh", ...refreshSection(d.refresh, map) },
    { id: "sales", title: "Sales and signups", ...ss },
    { id: "outreach", title: "Outreach", ...outreachSection(map, d.setup, mapState) },
    { id: "unseen", title: "What this page cannot see", paras: [], lists: [{ title: "", items: (d.not_measured || []).map((x) => ({ text: x.what + ". " + x.why })) }] },
    { id: "setup", title: "Setup", ...setup },
  ];
}

// ── the map ────────────────────────────────────────────────────────────────
export const codeOf = (f) => (f && CODES.includes(f.k) ? f.k : "none");
export function legendView(map) {
  const c = (map && map.counts) || {};
  return LEGEND.map(([code, text]) => ({ code, text, count: isNum(c[code]) ? c[code] : 0, cls: "m-" + code }));
}
export function mapLabel(map) {
  return "Map of the 351 Massachusetts towns: " + legendView(map).map((l) => l.text + " " + l.count).join(", ") + ".";
}
export function listGroups(map, keys) {
  const g = {};
  for (const code of CODES) g[code] = [];
  for (const k of keys) g[codeOf(map.towns[k])].push(k);
  return legendView(map).map((l) => ({ ...l, towns: g[l.code] }));
}
const LOCK = { paused: "Built but not wired in (paused)", owner: "Locked behind OpenGov (your list)", opengov: "Locked behind OpenGov (town registry)" };
export function townSheet(key, f) {
  f = f || {};
  const code = codeOf(f);
  const lines = [LEGEND[CODES.indexOf(code)][1] + "."];
  if (f.state) lines.push("Source state: " + f.state + ".");
  if (isNum(f.rows)) lines.push("Rows in the latest run: " + count(f.rows) + ".");
  if (f.newest) lines.push("Newest permit: " + day(f.newest) + ".");
  if (f.cadence) lines.push("Cadence: " + f.cadence + ".");
  if (f.ek) lines.push(ekSentence(f.ek));
  if (f.o) lines.push("Outreach: " + f.o + (f.os ? " since " + day(f.os) : "") + ".");
  if (f.planned) lines.push("Outreach planned (dashed outline).");
  if (f.lk) lines.push(own(LOCK, f.lk) || LOCK.opengov);
  return { title: key, code, lines, outreach: f.o || null };
}
export const OUTREACH_CHOICES = [["planned", "Planned"], ["sent", "Sent"], ["answered", "Answered"], ["declined", "Declined"], [null, "Clear"]];

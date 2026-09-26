// MassPermits Mission Control: the view model. PURE: no DOM, no request, no
// storage, no clock. Every word the page shows about a state lives here, so the
// design variants differ only in CSS and markup. Colour is never the only
// signal: every state carries a word.

export const TILE_ORDER = ["paying", "revenue", "renewals", "failed", "monday", "refresh", "sales", "signups"];

export const CLEAR_TEXT = "Nothing is wrong that this page can see.";
export const ATTRIBUTION = "Boundaries: U.S. Census Bureau, TIGER/Line Shapefiles 2024";
export const NOT_REPORTED = "not reported";
export const NO_VALUE = "—"; // an em dash: a grey tile never shows 0 or $0

const WORDS = { green: "OK", amber: "WATCH", red: "ACT" };
const GREY_WORDS = {
  "not-connected": "NOT CONNECTED",
  unavailable: "UNAVAILABLE",
  unverified: "UNVERIFIED",
  pending: "NOT YET",
};
const CLASSES = { green: "st-ok", amber: "st-watch", red: "st-act" };

// Map legend: codes and text are fixed (and equal to the data route's).
export const LEGEND = [
  { code: "dead", label: "Stale or dead source" },
  { code: "weekly", label: "Live, weekly" },
  { code: "monthly", label: "Live, monthly or slower" },
  { code: "answered", label: "Outreach answered" },
  { code: "sent", label: "Outreach sent" },
  { code: "locked", label: "Locked behind OpenGov" },
  { code: "none", label: "Not covered" },
];
const CODES = new Set(LEGEND.map((l) => l.code));

// errKind codes -> the one sentence the page may show. Engine text never
// reaches the page; only these codes do.
export const EK_SENTENCES = {
  owner_name_gate: "The engine's privacy guard stopped this town's rows (a parser fix is needed; nothing was published)",
  access_controlled: "Blocked by the town's site. That is an authorization decision: do not retry, it will not come back by itself.",
  no_rows: "Returned no rows",
  timeout: "The town's site timed out",
  http_error: "The town's site returned an error",
  parse: "The town's page changed shape (parser)",
  other: "Failed (the reason is not shown on this page)",
};

export const FAIL_KIND_WORDS = { crash: "crashed", gate: "stopped by its quality gate", unknown: "failed" };

export const SENTENCES = {
  notOwner: "Not signed in as the owner. Reload to sign in again.",
  couldNotRead: "Could not read the data. Reload; if it stays, check /admin/pipeline.",
  mapFailed: "The map could not load. Reload.",
  mapLoading: "Loading the map…",
  loading: "Loading",
  noCustomers: "No customers yet.",
};

const OUTREACH_WORDS = { planned: "Planned", sent: "Sent", answered: "Answered", declined: "Declined" };
export const OUTREACH_CHOICES = ["planned", "sent", "answered", "declined", null];

// small formatters
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const str = (v) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));

export function ekSentence(code) {
  return Object.prototype.hasOwnProperty.call(EK_SENTENCES, code) ? EK_SENTENCES[code] : EK_SENTENCES.other;
}

export function failKindWord(k) {
  return Object.prototype.hasOwnProperty.call(FAIL_KIND_WORDS, k) ? FAIL_KIND_WORDS[k] : FAIL_KIND_WORDS.unknown;
}

export function count(n) {
  return isNum(n) ? n.toLocaleString("en-US") : NO_VALUE;
}

export function money(cents, currency) {
  if (!isNum(cents)) return NO_VALUE;
  const code = (typeof currency === "string" && /^[a-z]{3}$/i.test(currency) ? currency : "usd").toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(cents / 100);
  } catch (_) {
    return "$" + (cents / 100).toFixed(2);
  }
}

const NY = "America/New_York";
function fmt(iso, o) {
  const t = Date.parse(str(iso));
  if (!Number.isFinite(t)) return null;
  return new Intl.DateTimeFormat("en-US", o).format(new Date(t));
}

export function timeNY(iso) {
  return fmt(iso, { timeZone: NY, month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    timeZoneName: "short" }) || NOT_REPORTED;
}

export function dayNY(iso) {
  return fmt(iso, { timeZone: NY, month: "short", day: "numeric", year: "numeric" }) || NOT_REPORTED;
}

// A "YYYY-MM-DD" stays that calendar date; instants show in the owner's zone.
export function date(d) {
  const s = str(d);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return dayNY(s);
  return fmt(s + "T12:00:00Z", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }) || s;
}

// tiles
export function stateOf(state, grey) {
  if (state === "grey") {
    if (Object.prototype.hasOwnProperty.call(GREY_WORDS, grey)) return { word: GREY_WORDS[grey], cls: "st-grey" };
    return { word: GREY_WORDS.unavailable, cls: "st-grey" };
  }
  if (Object.prototype.hasOwnProperty.call(WORDS, state)) return { word: WORDS[state], cls: CLASSES[state] };
  return { word: GREY_WORDS.unavailable, cls: "st-grey" };
}

export function tileModel(t) {
  const tt = isObj(t) ? t : {};
  const st = stateOf(tt.state, tt.grey);
  const known = tt.state === "green" || tt.state === "amber" || tt.state === "red";
  const unverified = tt.state === "grey" && tt.grey === "unverified";
  let value = NO_VALUE;
  if ((known || unverified) && isNum(tt.value)) {
    value = tt.id === "revenue" ? money(tt.value) : count(tt.value);
    if (/^at least\b/.test(str(tt.sub))) value = "at least " + value;
  }
  const label = str(tt.label) || str(tt.id);
  return {
    id: str(tt.id), label, word: st.word, cls: st.cls, value,
    sub: str(tt.sub), asOf: tt.as_of ? timeNY(tt.as_of) : "",
    aria: label + ": " + value + ", " + st.word,
  };
}

export function tilesModel(list) {
  const byId = new Map();
  for (const t of Array.isArray(list) ? list : []) if (isObj(t) && !byId.has(t.id)) byId.set(t.id, t);
  return TILE_ORDER.map((id) => tileModel(byId.get(id) || { id, label: id, state: "grey", grey: "unavailable" }));
}

export function headlineModel(h) {
  const s = isObj(h) ? h : {};
  if (s.state === "red") return { word: "ACT", cls: "st-act", text: str(s.text) };
  if (s.state === "amber") return { word: "WATCH", cls: "st-watch", text: str(s.text) };
  return { word: "OK", cls: "st-ok", text: s.state === "clear" && s.text ? str(s.text) : CLEAR_TEXT };
}

// needs you
// Red, then amber, in the route's order. Known lines go in their own
// collapsed group, never styled red or amber and never the headline.
export function needsModel(lines) {
  const all = Array.isArray(lines) ? lines.filter(isObj) : [];
  const pick = (sev) => all.filter((l) => l.severity === sev).map((l) => ({
    id: str(l.id), text: str(l.text), where: str(l.where),
    word: sev === "red" ? "ACT" : sev === "amber" ? "WATCH" : "KNOWN",
    cls: sev === "red" ? "st-act" : sev === "amber" ? "st-watch" : "st-known",
  }));
  const urgent = pick("red").concat(pick("amber"));
  const known = pick("known");
  return { urgent, known, knownTitle: "Known, not new (" + known.length + ")" };
}

// the default view
// resp: {status, body} (status 0 = the request never answered).
export function mainModel(resp) {
  const r = isObj(resp) ? resp : { status: 0, body: null };
  const b = isObj(r.body) ? r.body : null;
  if (r.status === 403 && b && b.reason === "not-configured") return { kind: "setup" };
  if (r.status === 403) return { kind: "message", text: SENTENCES.notOwner };
  if (r.status !== 200 || !b || b.ok !== true) return { kind: "message", text: SENTENCES.couldNotRead };
  return {
    kind: "ok",
    signedInAs: str(b.signed_in_as),
    headline: headlineModel(b.headline),
    tiles: tilesModel(b.tiles),
    needs: needsModel(b.needs_you),
    outreachEdit: b.outreach_edit === true,
    now: str(b.now),
  };
}

// the map
export function mapModel(resp, geo) {
  const r = isObj(resp) ? resp : { status: 0, body: null };
  const b = isObj(r.body) ? r.body : null;
  const g = isObj(geo) && isObj(geo.body) ? geo.body : null;
  if (!b || r.status !== 200 || b.ok !== true || !g || !isObj(g.towns)) return { kind: "failed" };
  const facts = isObj(b.towns) ? b.towns : {};
  const keys = Object.keys(g.towns);
  const fills = {};
  const counts = {};
  for (const l of LEGEND) counts[l.code] = 0;
  for (const k of keys) {
    const f = isObj(facts[k]) ? facts[k] : null;
    const code = f && CODES.has(f.k) ? f.k : "none"; // an unknown code is never a live colour
    fills[k] = { code, planned: !!(f && f.planned === 1) };
    counts[code]++;
  }
  const legend = LEGEND.map((l) => ({ code: l.code, label: l.label, count: counts[l.code], cls: "k-" + l.code }));
  const groups = LEGEND.map((l) => ({
    code: l.code, label: l.label, cls: "k-" + l.code,
    towns: keys.filter((k) => fills[k].code === l.code).sort(),
  }));
  const summary = "Map of " + keys.length + " Massachusetts towns: " +
    legend.map((l) => l.label + " " + l.count).join(", ") + ".";
  return {
    kind: "ok", viewBox: str(g.viewBox) || "0 0 2000 1272", fillRule: str(g.fill_rule) || "evenodd",
    paths: keys.map((k) => ({ key: k, d: str(g.towns[k] && g.towns[k].d) })),
    fills, legend, groups, summary,
    unmatched: Array.isArray(b.unmatched) ? b.unmatched.map(str) : [],
    outreachIgnored: Array.isArray(b.outreach_ignored) ? b.outreach_ignored.map(str) : [],
    opengov: isObj(b.opengov) ? b.opengov : {},
    asOf: isObj(b.as_of) ? b.as_of : {},
    facts,
  };
}

const LOCK_WORDS = { paused: "Paused: built, not wired", owner: "Locked (owner's list)", opengov: "Locked (registry: OpenGov)" };

export function townSheet(key, mm, geo) {
  const g = isObj(geo) && isObj(geo.body) ? geo.body : {};
  const town = isObj(g.towns) && isObj(g.towns[key]) ? g.towns[key] : {};
  const f = mm && isObj(mm.facts) && isObj(mm.facts[key]) ? mm.facts[key] : {};
  const code = mm && mm.fills && mm.fills[key] ? mm.fills[key].code : "none";
  const legend = LEGEND.find((l) => l.code === code) || LEGEND[LEGEND.length - 1];
  const rows = [["Status", legend.label]];
  const county = isObj(g.counties) ? g.counties[town.c] : null;
  if (county) rows.push(["County", str(county)]);
  if (f.state) rows.push(["Source state", str(f.state)]);
  if (isNum(f.rows)) rows.push(["Rows in the latest run", count(f.rows)]);
  if (f.newest) rows.push(["Newest permit", date(f.newest)]);
  if (f.cadence) rows.push(["Cadence", str(f.cadence)]);
  if (f.ek) rows.push(["Why it failed", ekSentence(f.ek)]);
  if (f.lk) rows.push(["Lock", LOCK_WORDS[f.lk] || str(f.lk)]);
  if (f.o) rows.push(["Outreach", OUTREACH_WORDS[f.o] || str(f.o)]);
  if (f.os) rows.push(["Outreach since", date(f.os)]);
  if (f.planned === 1) rows.push(["Planned", "Yes (dashed outline, no colour)"]);
  return { key, title: key, code, cls: "k-" + code, rows, outreach: f.o || null };
}

export function outreachWord(v) {
  return v === null ? "Clear" : OUTREACH_WORDS[v] || str(v);
}

// details
// Sections are lists of blocks: text, facts [[k, v]], people [{name, line, link}].
const nr = (v) => (isNum(v) ? count(v) : NOT_REPORTED);

const txt = (text) => ({ type: "text", text });
const facts = (rows) => ({ type: "facts", rows });

function yesNo(v) {
  return v === true ? "yes" : v === false ? "no" : NOT_REPORTED;
}

// Only a Stripe dashboard link built from a validated id is ever a link.
const STRIPE_LINK = /^(https):\/\/dashboard\.stripe\.com\/(customers|subscriptions|invoices)\/(cus|sub|in)_[A-Za-z0-9]{6,64}$/;

function people(rows, empty) {
  const list = Array.isArray(rows) ? rows.filter(isObj) : [];
  return {
    type: "people", empty,
    rows: list.map((r) => ({
      name: str(r.name) || "(no name)",
      line: [r.email_masked, r.t8 ? "token " + r.t8 : "", r.plan, r.status,
        r.since ? "since " + date(r.since) : "", r.date ? date(r.date) : "",
        isNum(r.amount_cents) ? money(r.amount_cents, r.currency) : ""].map(str).filter(Boolean).join(" · "),
      link: typeof r.stripe_url === "string" && STRIPE_LINK.test(r.stripe_url) ? r.stripe_url : "",
    })),
  };
}

export function detailsModel(mainBody, mm) {
  const b = isObj(mainBody) ? mainBody : {};
  const d = isObj(b.detail) ? b.detail : {};
  const out = [];

  // Customers
  const c = isObj(d.customers) ? d.customers : {};
  const eng = isObj(d.engagement) ? d.engagement : null;
  const cBlocks = [facts([
    ["Active", nr(c.count)],
    ["Cancelled or inactive", nr(c.cancelled)],
  ])];
  cBlocks.push(people(c.rows, isNum(c.count) ? SENTENCES.noCustomers : "The subscriber list could not be read."));
  if (isNum(c.more) && c.more > 0) cBlocks.push(txt("+" + count(c.more) + " more not listed"));
  if (eng) {
    cBlocks.push(facts(Object.keys(eng).map((k) => ["Engagement: " + k.replace(/-/g, " "), count(eng[k])])));
  }
  out.push({ id: "customers", title: "Customers", blocks: cBlocks });

  // Renewals and failed payments
  const rn = isObj(d.renewals) ? d.renewals : null;
  const fp = isObj(d.failed_payments) ? d.failed_payments : {};
  out.push({ id: "renewals", title: "Renewals and failed payments", blocks: [
    txt("Renewals in the next 14 days"),
    rn ? people(rn.rows, "No renewals in the next 14 days.") : txt("Stripe is not connected; renewals are not shown."),
    txt("Failed payments"),
    people(fp.rows, "No failed payment is flagged."),
  ] });

  // Monday delivery
  const m = isObj(d.monday) ? d.monday : {};
  const mBlocks = [facts([
    ["Monday", date(m.monday_date)],
    ["Delivered", isNum(m.delivered) ? count(m.delivered) + (isNum(m.expected) ? " of " + count(m.expected) : "") : NOT_REPORTED],
    ["Logged at", m.best_at ? timeNY(m.best_at) : "nothing logged since the send was due"],
    ["Hold deadline", timeNY(m.hold)],
    ["Sent more than once", nr(m.duplicates)],
    ["New since Monday", nr(m.new_since_monday)],
    ["Skipped only", yesNo(m.skipped_only)],
  ])];
  mBlocks.push(txt("Not reached"), people(m.missing, "Nobody expected was missed."));
  mBlocks.push(txt("Failed"), people(m.failed, "No delivery failed."));
  if (Array.isArray(m.joined_on_send_day) && m.joined_on_send_day.length) {
    mBlocks.push(txt("Joined on send day (not counted as missing)"), people(m.joined_on_send_day, ""));
  }
  if (m.caveat) mBlocks.push(txt(str(m.caveat)));
  out.push({ id: "monday", title: "Monday delivery", blocks: mBlocks });

  // Data refresh
  const rf = isObj(d.refresh) ? d.refresh : {};
  const cov = isObj(rf.coverage) ? rf.coverage : null;
  const rfRows = [
    ["Ran at", timeNY(rf.ran_at)],
    ["Result", rf.ok === true ? "ok" : rf.degraded === true ? "reduced run" : rf.ok === false ? failKindWord(rf.fail_kind) : NOT_REPORTED],
    ["Rows", nr(rf.count)],
    ["Coverage", cov && isNum(cov.live_sources) && isNum(cov.expected_sources)
      ? count(cov.live_sources) + " of " + count(cov.expected_sources) + " sources live" : NOT_REPORTED],
    ["Coverage disclosed to subscribers", cov ? yesNo(cov.disclose) : NOT_REPORTED],
    ["Status file uploaded", timeNY(rf.status_uploaded)],
    ["Weekly bundle uploaded", timeNY(rf.weekly_uploaded)],
    ["Portal page uploaded", timeNY(rf.portal_uploaded)],
    ["Same bundle as the last send", yesNo(rf.same_bundle_as_last_send)],
  ];
  const srcs = Array.isArray(rf.sources) ? rf.sources.filter(isObj) : [];
  out.push({ id: "refresh", title: "Data refresh", blocks: [
    facts(rfRows),
    txt("Sources in trouble"),
    { type: "people", empty: "No source is in trouble.", rows: srcs.map((s) => ({
      name: str(s.town),
      line: [str(s.state), s.since ? "since " + date(s.since) : "", ekSentence(s.ek)].filter(Boolean).join(" · "),
      link: "",
    })) },
  ] });

  // Sales and signups
  const sa = isObj(d.sales) ? d.sales : null;
  const su = isObj(d.signups) ? d.signups : null;
  const ssBlocks = [];
  if (sa) {
    ssBlocks.push(facts([
      ["New checkouts, 7 days", count(sa.new_checkouts)],
      ["Renewal deliveries, 7 days", count(sa.renewal_deliveries)],
      ["Gross, 7 days", isNum(sa.gross_cents) ? money(sa.gross_cents) : "Stripe is not connected"],
      ["New subscriptions", isNum(sa.new_subscription_cents) ? money(sa.new_subscription_cents) : NO_VALUE],
      ["Packs", isNum(sa.pack_cents) ? money(sa.pack_cents) : NO_VALUE],
    ]), people(sa.rows, "No new checkout in 7 days."));
  } else {
    ssBlocks.push(txt("The delivery log could not be read."));
  }
  if (su) {
    const pre = su.at_least ? "at least " : "";
    const byDay = isObj(su.by_day) ? su.by_day : {};
    const trades = isObj(su.trades) ? su.trades : {};
    ssBlocks.push(facts([
      ["Prospects, 7 days", pre + count(su.prospects)],
      ["Agents, 7 days", pre + count(su.agents)],
      ["Newsletter, new in 7 days", pre + count(su.newsletter_new)],
      ["Newsletter confirmed", pre + count(su.newsletter_confirmed)],
      ["Newsletter pending", pre + count(su.newsletter_pending)],
    ]));
    ssBlocks.push(facts(Object.keys(byDay).map((k) => [date(k), count(byDay[k])])));
    if (Object.keys(trades).length) {
      ssBlocks.push(facts(Object.keys(trades).map((k) => ["Trade: " + k, count(trades[k])])));
    }
  } else {
    ssBlocks.push(txt("The signup lists could not be read."));
  }
  out.push({ id: "sales", title: "Sales and signups", blocks: ssBlocks });

  // Outreach
  const st = isObj(d.setup) ? d.setup : {};
  const oBlocks = [];
  if (mm && mm.kind === "ok") {
    const byState = {};
    for (const k of Object.keys(mm.facts).sort()) {
      const f = mm.facts[k];
      if (isObj(f) && f.o) (byState[f.o] = byState[f.o] || []).push(k);
    }
    oBlocks.push(facts(["planned", "sent", "answered", "declined"].map((s) =>
      [OUTREACH_WORDS[s], byState[s] ? byState[s].join(", ") : "none"])));
    oBlocks.push(facts([
      ["OpenGov, registry", count(mm.opengov.registry)],
      ["OpenGov, owner list", count(mm.opengov.owner_list)],
      ["Outreach towns not on the map", mm.outreachIgnored.length ? mm.outreachIgnored.join(", ") : "none"],
      ["Production keys not on the map", mm.unmatched.length ? mm.unmatched.join(", ") : "none"],
    ]));
  } else {
    oBlocks.push(txt(SENTENCES.mapFailed));
  }
  oBlocks.push(facts([["Outreach object", str(st.outreach) || NOT_REPORTED]]));
  if (b.outreach_edit === true) oBlocks.push(txt("Editing is on: open a town on the map or in the list to change its outreach."));
  out.push({ id: "outreach", title: "Outreach", blocks: oBlocks });

  // What this page cannot see
  const nm = Array.isArray(d.not_measured) ? d.not_measured.filter(isObj) : [];
  out.push({ id: "cannot", title: "What this page cannot see", blocks: [
    facts(nm.map((x) => [str(x.what), str(x.why)])),
  ] });

  // Setup
  const we = isObj(st.webhook_events) ? st.webhook_events : {};
  const ev = (v) => (v === true ? "registered" : v === false ? "not registered" : "unknown");
  out.push({ id: "setup", title: "Setup", blocks: [facts([
    ["Stripe", str(st.stripe) || NOT_REPORTED],
    ["Price list", str(st.price_list) || NOT_REPORTED],
    ["invoice.payment_failed", ev(we["invoice.payment_failed"])],
    ["customer.subscription.deleted", ev(we["customer.subscription.deleted"])],
    ["Outreach object", str(st.outreach) || NOT_REPORTED],
    ["Registry uploaded", dayNY(st.registry)],
  ])] });
  return out;
}

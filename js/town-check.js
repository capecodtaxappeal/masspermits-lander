// MassPermits homepage: "Check your towns" box and the optional towns/role
// fields on the free-sample form. Loaded by index.html (TOWN CHECK blocks).
//
// Data, both public and same-origin:
//   /js/ma-towns.json                 all 351 municipalities + aliases
//                                     (built by scripts/build-ma-towns.mjs)
//   /research/evidence/coverage.json  the daily coverage evidence; only
//                                     stats.table[].source/.last, stats.monthly
//                                     and stats.errors are read
//
// Status rules (test/town-check.test.mjs pins them):
//   weekly   a source, not monthly, not errored, last within 10 days of the
//            newest last date in the table
//   monthly  listed monthly, last within 55 days of the newest
//   paused   errored, or a source outside those bands
//   absent   no source; followed by covered towns in the same county
// No rates, counts or town-to-town comparisons are computed or shown.
// If either file fails to load or has an unexpected shape, the box stays hidden.
(function (root) {
  "use strict";
  var WEEKLY_DAYS = 10, MONTHLY_DAYS = 55, MAX_TOWNS = 10;
  var ROLES = ["Owner or on the tools", "Office, sales or estimating", "Supplier or distributor"];
  var DATE = /^\d{4}-\d{2}-\d{2}$/;
  var DAY = 864e5;

  function norm(s) { return String(s || "").trim().replace(/\s+/g, " ").toLowerCase(); }
  function dayMs(d) { return Date.parse(d + "T00:00:00Z"); }

  // The towns file, or null if it is not the shape we expect.
  function checkTowns(t) {
    if (!t || typeof t !== "object" || !t.towns || typeof t.towns !== "object") return null;
    var names = Object.keys(t.towns);
    if (names.length < 300) return null;
    var aliases = t.aliases && typeof t.aliases === "object" ? t.aliases : {};
    var byLower = {};
    names.forEach(function (n) { byLower[norm(n)] = n; });
    return { names: names, county: t.towns, counties: t.counties || {}, aliases: aliases, byLower: byLower };
  }

  // Canonical name for what someone typed ("foxboro" -> "Foxborough"), or "".
  function resolveTown(q, towns) {
    var k = norm(q);
    if (!k || !towns) return "";
    if (towns.byLower[k]) return towns.byLower[k];
    var a = towns.aliases[k];
    return a && towns.county[a] ? a : "";
  }

  // The coverage file reduced to what the status needs, or null if its shape is off.
  function checkCoverage(cov, towns) {
    var s = cov && cov.stats;
    if (!s || !Array.isArray(s.table) || !s.table.length || !Array.isArray(s.monthly) || !Array.isArray(s.errors)) return null;
    var rows = {}, newest = "";
    for (var i = 0; i < s.table.length; i++) {
      var r = s.table[i];
      if (!r || typeof r.source !== "string" || typeof r.last !== "string" || !DATE.test(r.last)) return null;
      var name = resolveTown(r.source.replace(/,\s*MA$/, ""), towns);
      if (name) rows[name] = r.last;
      if (r.last > newest) newest = r.last;
    }
    function names(list) {
      var out = {};
      list.forEach(function (src) {
        var n = typeof src === "string" ? resolveTown(src.replace(/,\s*MA$/, ""), towns) : "";
        if (n) out[n] = true;
      });
      return out;
    }
    return { rows: rows, newest: newest, monthly: names(s.monthly), errors: names(s.errors) };
  }

  function bareStatus(name, cv) {
    var last = cv.rows[name];
    if (cv.errors[name]) return { status: "paused", last: last || "" };
    if (!last) return { status: "absent", last: "" };
    var age = (dayMs(cv.newest) - dayMs(last)) / DAY;
    if (cv.monthly[name]) return age <= MONTHLY_DAYS ? { status: "monthly", last: last } : { status: "paused", last: last };
    return age <= WEEKLY_DAYS ? { status: "weekly", last: last } : { status: "paused", last: last };
  }

  // Status of one canonical town name. cv from checkCoverage, towns from checkTowns.
  function townStatus(name, cv, towns) {
    var st = bareStatus(name, cv);
    if (st.status === "weekly") st.label = "In the weekly file";
    else if (st.status === "monthly") st.label = "Arrives monthly, newest permit " + st.last;
    else if (st.status === "paused") st.label = st.last ? "Paused, newest permit " + st.last : "Paused";
    else {
      st.label = "Not covered yet";
      var c = towns.county[name];
      st.county = towns.counties[c] || "";
      st.nearby = Object.keys(cv.rows).filter(function (n) {
        if (n === name || towns.county[n] !== c) return false;
        var s = bareStatus(n, cv).status;
        return s === "weekly" || s === "monthly";
      }).sort();
    }
    return st;
  }

  var api = { WEEKLY_DAYS: WEEKLY_DAYS, MONTHLY_DAYS: MONTHLY_DAYS, MAX_TOWNS: MAX_TOWNS, ROLES: ROLES,
    checkTowns: checkTowns, resolveTown: resolveTown, checkCoverage: checkCoverage, townStatus: townStatus };
  root.mpTownCheck = api;
  if (typeof document === "undefined") return;

  // ---- page wiring ----------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }
  function getJson(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(url); return r.json(); });
  }

  var TOWNS = null, chosen = [];

  // Sample form: what /api/request-sample gets on top of the email (only).
  root.mpSampleExtras = function () {
    var out = {};
    if (chosen.length) out.towns = chosen.slice(0, MAX_TOWNS);
    var role = $("sx-role") ? $("sx-role").value : "";
    if (ROLES.indexOf(role) >= 0) out.role = role;
    return out;
  };

  function renderChips() {
    var box = $("sx-chips");
    if (!box) return;
    box.textContent = "";
    chosen.forEach(function (n) {
      var b = el("button", "sx-chip", n + " ×");
      b.type = "button";
      b.setAttribute("aria-label", "Remove " + n);
      b.onclick = function () { chosen = chosen.filter(function (x) { return x !== n; }); renderChips(); };
      box.appendChild(b);
    });
    var inp = $("sx-town");
    if (inp) inp.disabled = chosen.length >= MAX_TOWNS;
    var note = $("sx-note");
    if (note) note.textContent = chosen.length >= MAX_TOWNS ? "That is the limit of 10 towns." : "";
  }
  function addChip(name) {
    if (!name || chosen.indexOf(name) >= 0 || chosen.length >= MAX_TOWNS) return false;
    chosen.push(name);
    renderChips();
    return true;
  }

  function wireExtras() {
    var box = $("sx"), inp = $("sx-town");
    if (!box || !inp) return;
    function take() {
      var n = resolveTown(inp.value, TOWNS);
      if (n) { addChip(n); inp.value = ""; }
      return !!n;
    }
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); take(); }
    });
    inp.addEventListener("change", take);
    var add = $("sx-add");
    if (add) add.onclick = function () { take(); inp.focus(); };
    box.hidden = false;
  }

  function wireCheck(cv) {
    var box = $("town-check"), form = $("tc-form"), inp = $("tc-input"), list = $("tc-results"), msg = $("tc-msg");
    if (!box || !form || !inp || !list) return;
    var checked = [];
    function draw() {
      list.textContent = "";
      checked.forEach(function (n) {
        var st = townStatus(n, cv, TOWNS);
        var li = el("li", "tc-row tc-" + st.status);
        li.appendChild(el("b", "", n));
        li.appendChild(el("span", "tc-status", st.label));
        if (st.status === "absent" && st.nearby.length) {
          li.appendChild(el("span", "tc-near", "Covered in " + (st.county ? st.county + " County" : "the same county") + ": " + st.nearby.join(", ")));
        }
        var go = el("button", "tc-go", "Get a free sample for these towns");
        go.type = "button";
        go.onclick = function () {
          checked.forEach(addChip);
          var s = $("sample"), em = $("email");
          if (s && s.scrollIntoView) s.scrollIntoView({ behavior: "smooth", block: "start" });
          if (em) { try { em.focus({ preventScroll: true }); } catch (_e) { em.focus(); } }
        };
        li.appendChild(go);
        list.appendChild(li);
      });
    }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var n = resolveTown(inp.value, TOWNS);
      if (msg) msg.textContent = n ? "" : "No Massachusetts town or city by that name. Try the full name.";
      if (!n) return;
      checked = [n].concat(checked.filter(function (x) { return x !== n; })).slice(0, MAX_TOWNS);
      inp.value = "";
      draw();
    });
    box.hidden = false;
  }

  function start() {
    getJson("/js/ma-towns.json").then(function (t) {
      TOWNS = checkTowns(t);
      if (!TOWNS) return;
      var dl = document.createElement("datalist");
      dl.id = "mp-ma-towns";
      TOWNS.names.forEach(function (n) { var o = document.createElement("option"); o.value = n; dl.appendChild(o); });
      document.body.appendChild(dl);
      wireExtras();
      return getJson("/research/evidence/coverage.json").then(function (cov) {
        var cv = checkCoverage(cov, TOWNS);
        if (cv) wireCheck(cv);
      });
    }).catch(function () { /* the boxes stay hidden */ });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})(typeof window !== "undefined" ? window : globalThis);

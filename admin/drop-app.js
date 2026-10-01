// Drop box page script. Builds every node with createElement and textContent:
// no HTML sink, no storage API. Reads and writes only /admin/api/drop.

const API = "/admin/api/drop";
const MAX = 10 * 1024 * 1024;
const HDR = { "X-MassPermits-Drop": "1" };

const $ = (id) => document.getElementById(id);
const el = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
};

function size(n) {
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
  if (n >= 1024) return Math.round(n / 1024) + " KB";
  return n + " B";
}
function when(iso) {
  if (!iso) return "never";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "unknown";
}
function day(iso) {
  return iso ? when(iso).slice(0, 10) : "never";
}
function stateClass(s) {
  return s === "ok" ? "state-ok" : s === "due soon" ? "state-due" : "state-overdue";
}

function status(text, ok) {
  const s = $("status");
  s.textContent = text;
  s.className = "status " + (ok ? "ok" : "bad");
}

function render(data) {
  const sel = $("slug");
  const keep = sel.value;
  sel.replaceChildren();
  const pick = el("option", "Choose a source");
  pick.value = "";
  sel.append(pick);
  for (const s of data.sources) {
    const o = el("option", s.label + " (" + s.accept.join(", ") + ")");
    o.value = s.slug;
    sel.append(o);
  }
  if (keep && data.sources.some((s) => s.slug === keep)) sel.value = keep;

  const body = $("fresh").tBodies[0];
  body.replaceChildren();
  for (const s of data.sources) {
    const tr = el("tr");
    tr.append(el("td", s.label), el("td", day(s.last_received)),
      el("td", s.days_since == null ? "n/a" : String(s.days_since)), el("td", s.cadence),
      el("td", s.state, stateClass(s.state)));
    body.append(tr);
  }
  if (!data.sources.length) {
    const tr = el("tr");
    const td = el("td", "No sources configured. Set MANUAL_SOURCES on the Pages project.");
    td.colSpan = 5;
    tr.append(td);
    body.append(tr);
  }

  const box = $("receipts");
  box.replaceChildren();
  box.className = "receipts";
  for (const s of data.sources) {
    box.append(el("h3", s.label));
    if (!s.receipts.length) { box.append(el("p", "Nothing received yet.", "muted")); continue; }
    const wrap = el("div", undefined, "scroll");
    const t = el("table");
    const head = el("tr");
    head.append(el("th", "Date"), el("th", "Size"), el("th", "Type"), el("th", "Via"));
    t.append(head);
    for (const r of s.receipts) {
      const tr = el("tr");
      tr.append(el("td", when(r.received_at)), el("td", size(r.bytes)), el("td", r.ext.toUpperCase()), el("td", r.via));
      t.append(tr);
    }
    wrap.append(t);
    box.append(wrap);
  }
}

async function load() {
  try {
    const r = await fetch(API, { headers: HDR, credentials: "same-origin", cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    render(await r.json());
    $("load-error").hidden = true;
  } catch (_) {
    $("load-error").hidden = false;
  }
}

async function send(file) {
  const slug = $("slug").value;
  if (!slug) return status("Choose a source first.", false);
  if (!file) return;
  if (file.size === 0) return status("That file is empty.", false);
  if (file.size > MAX) return status("That file is over 10 MB.", false);
  status("Uploading...", true);
  try {
    const r = await fetch(API, {
      method: "POST",
      credentials: "same-origin",
      headers: { ...HDR, "Content-Type": "application/octet-stream", "X-Drop-Slug": slug,
        "X-Drop-Name": encodeURIComponent(file.name.slice(0, 200)) },
      body: file,
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.status === "stored") status("Received: " + String(j.ext || "").toUpperCase() + ", " + size(j.bytes) + ".", true);
    else if (r.ok && j.status === "duplicate") status("Already received. Nothing new was stored.", true);
    else status("Not accepted: " + String(j.error || r.status).replace(/-/g, " ") + ".", false);
  } catch (_) {
    status("Upload failed. Check the connection and try again.", false);
  }
  $("file").value = "";
  load();
}

function wire() {
  const zone = $("zone");
  const input = $("file");
  zone.addEventListener("click", () => input.click());
  zone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
  });
  input.addEventListener("change", () => send(input.files && input.files[0]));
  for (const ev of ["dragenter", "dragover"]) {
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add("over"); });
  }
  for (const ev of ["dragleave", "drop"]) {
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove("over"); });
  }
  zone.addEventListener("drop", (e) => {
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length === 1) send(files[0]);
    else status("Drop one file at a time.", false);
  });
  // A file dropped beside the zone must not navigate away from the page.
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());
  $("drop-form").addEventListener("submit", (e) => e.preventDefault());
}

wire();
load();

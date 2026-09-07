/*! MassPermits town widget loader v1 — masspermits.com/widget/
 *  Embed:  <script src="https://masspermits.com/widget/v1.js"
 *                  data-town="barnstable" async></script>
 *  Or place containers anywhere and load this once:
 *          <div data-mp-permits="barnstable"></div>
 *
 *  This file builds an iframe and keeps it the right height. That is all it
 *  does. Every figure, every caveat and every word the visitor reads comes from
 *  masspermits.com at load time, so a correction we ship reaches this page on
 *  its next view without anyone touching it.
 *
 *  It sets no cookie, reads no storage, and touches nothing on the host page
 *  except the element it creates. Licence: CC BY-NC 4.0, attribution required
 *  and built into the widget — please leave the "Data: MassPermits" line in.
 */
(function () {
  "use strict";
  var ORIGIN = "https://masspermits.com";
  var BASE = ORIGIN + "/widget/v1/t/";
  var W = (window.__mpWidget = window.__mpWidget || { frames: [], wired: false });

  function attr(el, n, d) {
    var v = el.getAttribute("data-" + n);
    return v === null || v === "" ? d : v;
  }

  function slugify(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  /* A guessed height is a layout shift; a measured one arrives a moment later.
     Guess close: header + stats + n rows + footer, in the renderer's own metrics. */
  function guess(rows) {
    return 196 + Math.max(1, Math.min(25, rows)) * 34 + 62;
  }

  function build(el, cfg) {
    var town = slugify(cfg.town);
    if (!town) return null;
    var q = [];
    if (cfg.trade) q.push("trade=" + encodeURIComponent(slugify(cfg.trade)));
    if (cfg.rows) q.push("rows=" + encodeURIComponent(cfg.rows));
    if (cfg.theme) q.push("theme=" + encodeURIComponent(cfg.theme));
    if (cfg.compact === "true" || cfg.compact === "1") q.push("compact=1");
    if (cfg.analytics === "off" || cfg.analytics === "0") q.push("t=0");
    /* The embedding site's ORIGIN only — never the page URL, never a query
       string, never anything a visitor typed. It lets us count which sites the
       widget actually reaches, which is the difference between this channel
       being measurable and being a guess. Turn it off with data-analytics="off". */
    if (cfg.analytics !== "off" && cfg.analytics !== "0") {
      try { q.push("ref=" + encodeURIComponent(location.origin)); } catch (e) {}
    }
    var f = document.createElement("iframe");
    f.src = BASE + town + ".html" + (q.length ? "?" + q.join("&") : "");
    f.title = cfg.title || ("Recent building permits in " + town.replace(/-/g, " ") +
                            ", Massachusetts — MassPermits");
    f.loading = "lazy";
    f.setAttribute("scrolling", "no");
    f.setAttribute("frameborder", "0");
    f.style.cssText = "display:block;width:100%;border:0;overflow:hidden;" +
      "color-scheme:normal;max-width:" + (cfg.maxwidth || "680px") + ";" +
      "height:" + guess(parseInt(cfg.rows, 10) || 8) + "px";
    /* No allow-scripts escape hatch needed by us, but a host may want to be
       strict; sandboxing to same-origin-less scripts is enough for the widget. */
    f.setAttribute("sandbox", "allow-scripts allow-popups allow-popups-to-escape-sandbox");
    W.frames.push(f);
    return f;
  }

  function wire() {
    if (W.wired) return;
    W.wired = true;
    window.addEventListener("message", function (e) {
      if (e.origin !== ORIGIN) return;
      var d = e.data;
      if (!d || d.mp !== 1 || typeof d.h !== "number") return;
      for (var i = 0; i < W.frames.length; i++) {
        if (W.frames[i].contentWindow === e.source) {
          W.frames[i].style.height = Math.max(120, Math.round(d.h)) + "px";
          return;
        }
      }
    }, false);
  }

  function cfgFrom(el) {
    return {
      town: attr(el, "town", el.getAttribute("data-mp-permits") || ""),
      trade: attr(el, "trade", ""), rows: attr(el, "rows", ""),
      theme: attr(el, "theme", ""), compact: attr(el, "compact", ""),
      maxwidth: attr(el, "maxwidth", ""), title: attr(el, "title", ""),
      analytics: attr(el, "analytics", "")
    };
  }

  wire();

  /* 1. the script tag itself, if it names a town: render in place. */
  var me = document.currentScript ||
    (function () {
      var s = document.getElementsByTagName("script");
      for (var i = s.length - 1; i >= 0; i--) {
        if ((s[i].src || "").indexOf("/widget/v1.js") > -1) return s[i];
      }
      return null;
    })();
  if (me && me.getAttribute("data-town")) {
    var f1 = build(me, cfgFrom(me));
    if (f1 && me.parentNode) me.parentNode.insertBefore(f1, me);
  }

  /* 2. any declarative containers on the page, now and after later DOM writes. */
  function hydrate() {
    var els = document.querySelectorAll("[data-mp-permits]:not([data-mp-done])");
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      el.setAttribute("data-mp-done", "1");
      var f = build(el, cfgFrom(el));
      if (f) { el.innerHTML = ""; el.appendChild(f); }
    }
  }
  hydrate();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", hydrate, false);
  }
  W.hydrate = hydrate;
})();

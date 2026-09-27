/* MassPermits: count clicks on Buy links. First party, no cookies, no personal data.
   ONE delegated listener on the document: any link to buy.stripe.com, on any
   page that loads this file, sends one beacon to the same endpoint as the page
   view beacon, with e=buy_click, the page path, the utm source and the public
   payment link path. The server stores it apart from page views. It never
   delays or blocks the click, and any error is swallowed. */
(function () {
  try {
    if (window.__mpBuyClick) return;
    window.__mpBuyClick = 1;
    var send = function (ev) {
      try {
        if (ev.type === "auxclick" && ev.button !== 1) return;
        var a = ev.target;
        while (a && a.nodeType === 1 && a.tagName !== "A") a = a.parentNode;
        if (!a || a.nodeType !== 1 || !a.href) return;
        var u = new URL(a.href, location.href);
        if (u.hostname !== "buy.stripe.com") return;
        var link = (u.pathname.split("/")[1] || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 40);
        var q = new URL(location.href);
        var s = q.searchParams.get("utm_source") || q.searchParams.get("ref") || "";
        var b = "/api/hit?e=buy_click&p=" + encodeURIComponent(location.pathname) +
          "&s=" + encodeURIComponent(s) + "&l=" + encodeURIComponent(link);
        if (navigator.sendBeacon) navigator.sendBeacon(b); else (new Image()).src = b;
      } catch (e) {}
    };
    document.addEventListener("click", send, true);
    document.addEventListener("auxclick", send, true);
  } catch (e) {}
})();

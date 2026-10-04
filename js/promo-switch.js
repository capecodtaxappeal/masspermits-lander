/* MassPermits PROMO SWITCH. The one place a Stripe promotion code is turned
   on or off on the hand-written pages (index.html, offer.html, offer/index.html).

   TO TURN A CODE BACK ON: change its false to true below. That is the only edit.
   Do it only after Patrick has watched the code apply at a real Stripe checkout.

   Why they are off (2026-10-04): the homepage said the $49 first month was
   "Applied automatically", and FOUNDER2026 did not apply at checkout in two
   separate sessions that day. FIRST90 ($9.90 on /offer and /offer/) has not
   been checked since. A page must never promise a price the checkout refuses.

   How the pages use it. Each promo's markup sits in
   <template data-promo="CODE">, followed at once by
   <script>window.mpPromo&&mpPromo("CODE")</script>. A template is never shown,
   read aloud or followed while its code is OFF. Elements marked
   data-promo-off="CODE" hold the full-price wording that shows while the code
   is OFF; they are removed when it is ON. The swap runs while the page is
   still being parsed, so turning a code on does not shift the layout. If this
   file fails to load, every code stays OFF. */
(function () {
  var MP_PROMO_ON = {
    FOUNDER2026: false, // homepage: $49 first-month banner and the pricing-box line
    FIRST90: false      // /offer and /offer/: $9.90 first month
  };
  window.MP_PROMO_ON = MP_PROMO_ON;
  window.mpPromo = function (code) {
    try {
      if (!Object.prototype.hasOwnProperty.call(MP_PROMO_ON, code) || MP_PROMO_ON[code] !== true) return;
      var t = document.querySelectorAll('template[data-promo="' + code + '"]');
      for (var i = 0; i < t.length; i++) t[i].parentNode.replaceChild(t[i].content.cloneNode(true), t[i]);
      var off = document.querySelectorAll('[data-promo-off="' + code + '"]');
      for (var j = 0; j < off.length; j++) off[j].parentNode.removeChild(off[j]);
    } catch (e) {}
  };
})();

// Price test client. Loaded synchronously in <head> on every page that quotes
// a price, BEFORE the body parses -- it sets data-pv on <html> and the CSS in
// each page picks the arm, so the wrong number never paints.
//
// Assignment is per browser, not per pageview: once written it never changes,
// so nobody watches the price move on them between visits.
//
// The amount actually charged is decided server-side in api/checkout.js. This
// file only decides what a visitor is shown and what gets logged.
(function () {
  var VARIANT_KEY = "fdl_pv";
  var VISITOR_KEY = "fdl_vid";
  var PENDING_KEY = "fdl_pv_new";

  var variant = "a";
  var visitorId = null;
  var preview = false;

  // data-ab-readonly: render the arm this visitor already has, but never assign
  // one and never log. For pages that aren't a shopping surface -- someone who
  // opened a share link is watching a reveal that was already paid for, and
  // counting them as an exposure would dilute both arms with non-shoppers.
  var self = document.currentScript;
  var readOnly = !!(self && self.hasAttribute("data-ab-readonly"));

  try {
    // ?pv=a / ?pv=b renders that arm for a look without joining the test:
    // nothing is stored and nothing is logged, so QA visits stay out of the
    // numbers and a leaked preview link can't pin anyone to a price.
    var forced = location.search.match(/[?&]pv=(a|b)(&|$)/);
    if (forced) {
      preview = true;
      variant = forced[1];
    } else if (readOnly) {
      variant = localStorage.getItem(VARIANT_KEY);
      if (variant !== "a" && variant !== "b") variant = "a";
    } else {
      variant = localStorage.getItem(VARIANT_KEY);
      if (variant !== "a" && variant !== "b") {
        variant = Math.random() < 0.5 ? "a" : "b";
        localStorage.setItem(VARIANT_KEY, variant);
        localStorage.setItem(PENDING_KEY, "1");
      }
      visitorId = localStorage.getItem(VISITOR_KEY);
      if (!visitorId || !/^[a-f0-9]{16,32}$/.test(visitorId)) {
        visitorId = "";
        for (var i = 0; i < 24; i++) {
          visitorId += "0123456789abcdef"[Math.floor(Math.random() * 16)];
        }
        localStorage.setItem(VISITOR_KEY, visitorId);
      }
    }
  } catch (e) {
    // Private mode, storage disabled, anything: fall back to the current price.
    variant = "a";
    visitorId = null;
  }

  document.documentElement.setAttribute("data-pv", variant);

  function send(event) {
    if (preview || readOnly || !visitorId) return;
    try {
      if (navigator.webdriver) return;
      var payload = JSON.stringify({
        visitorId: visitorId,
        variant: variant,
        event: event,
        path: location.pathname,
      });
      // sendBeacon survives the page unloading, which cta_click always does --
      // it fires on a click that immediately navigates away.
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/ab", new Blob([payload], { type: "application/json" }));
        return true;
      }
      fetch("/api/ab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(function () {});
      return true;
    } catch (e) {}
  }

  window.fdlAb = { variant: variant, visitorId: visitorId, track: send, preview: preview };

  document.addEventListener("DOMContentLoaded", function () {
    // Segments Clarity recordings and heatmaps by arm. At this sample size the
    // stats will stay directional for days, but watching twenty $19 sessions
    // tells you WHY they left, which no amount of counting will.
    try {
      if (window.clarity) window.clarity("set", "price_variant", variant);
    } catch (e) {}

    if (preview || readOnly) return;

    try {
      if (localStorage.getItem(PENDING_KEY) === "1") {
        // Kept until it lands, so a failed beacon retries on the next pageview.
        if (send("exposure")) localStorage.removeItem(PENDING_KEY);
      }
    } catch (e) {}

    // The step price actually kills: read the number, never clicked through.
    var ctas = document.querySelectorAll("[data-ab-cta]");
    for (var i = 0; i < ctas.length; i++) {
      ctas[i].addEventListener("click", function () {
        send("cta_click");
      });
    }
  });
})();

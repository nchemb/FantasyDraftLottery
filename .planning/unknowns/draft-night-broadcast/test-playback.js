/**
 * Regression tests for the three faults seen on the live Dynasty Way run:
 *   1. mobile: announcer silent (VO elements never unlocked by the JOIN tap)
 *   2. desktop: bed music arrived late (paused at prime, re-buffered at showtime)
 *   3. replay: a second of audio, then straight back to the end screen
 */
const fs = require("fs");
const { JSDOM } = require("jsdom");
const ROOT = "/Users/neej/Documents/Projects/FantasyDraftLottery";
const HTML = fs.readFileSync(ROOT + "/reveal.html", "utf8");
const JS = fs.readFileSync(ROOT + "/reveal.js", "utf8");

function makeDom(query, payload, opts) {
  opts = opts || {};
  const dom = new JSDOM(HTML, { runScripts: "outside-only", url: "https://x/reveal.html" + query });
  const { window } = dom;
  const log = [];
  window.HTMLMediaElement.prototype.play = function () {
    log.push({ el: this.id || "audio", act: "play", src: (this.src || "").slice(0, 40) });
    this.__paused = false;
    return Promise.resolve();
  };
  window.HTMLMediaElement.prototype.pause = function () {
    log.push({ el: this.id || "audio", act: "pause" });
    this.__paused = true;
  };
  window.HTMLMediaElement.prototype.load = function () {};
  Object.defineProperty(window.HTMLMediaElement.prototype, "paused", {
    get() { return this.__paused !== false; }, configurable: true,
  });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.confetti = () => {};
  window.fetch = (u) => {
    if (String(u).indexOf("/api/reveal-state") === 0 || String(u).indexOf("reveal-state") > -1) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(opts.stateResponse || {
        mode: "scheduled", scheduledAt: payload.scheduledAt,
        showStartedAt: payload.showStartedAt, serverNow: new Date().toISOString(),
      })});
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) });
  };
  window.eval(JS);
  window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
  return { window, log };
}

const past = new Date(Date.now() - 5000).toISOString();
// showtime must be within the 2.5s "fresh" window or the player correctly
// treats this as a late join and skips the intro cue.
const justNow = new Date(Date.now() - 300).toISOString();
const LIVE = {
  leagueName: "Dynasty Way Year 9", teamCount: 5, revealId: "moL7PcGSqgjE",
  teams: ["Ray", "will", "Liao", "Mau", "Kush"], weighted: true,
  sealedAt: past, commitmentHash: "abc", mode: "scheduled",
  scheduledAt: justNow, showStartedAt: justNow, serverNow: new Date().toISOString(),
  pickGapSeconds: 0, live: true,
  draftOrder: ["Mau", "Ray", "will", "Kush", "Liao"],
  audioManifest: {
    intro: "https://cdn/intro.mp3", twoRemain: "https://cdn/two.mp3",
    picks: { 1: "https://cdn/p1.mp3", 2: "https://cdn/p2.mp3", 3: "https://cdn/p3.mp3", 4: "https://cdn/p4.mp3", 5: "https://cdn/p5.mp3" },
    dur: { intro: 15337, twoRemain: 5906, picks: { 1: 8702, 2: 6220, 3: 8702, 4: 8231, 5: 7030 } },
  },
};

const results = [];
function t(name, pass, detail) { results.push({ name, pass, detail }); }

(async () => {
  // ---- 1 + 2: the JOIN tap ----
  const a = makeDom("?id=moL7PcGSqgjE", LIVE);
  await new Promise((r) => setTimeout(r, 120));
  a.log.length = 0;
  a.window.document.getElementById("joinBtn").click();
  await new Promise((r) => setTimeout(r, 150));

  const voPlays = a.log.filter((l) => l.el === "voPlayer" && l.act === "play");
  t("voPlayer unlocked during the JOIN gesture (mobile fix)",
    voPlays.length > 0 && (voPlays[0].src || "").indexOf("data:audio") === 0,
    voPlays.length ? voPlays[0].src.slice(0, 28) : "NEVER PLAYED");

  const bedEvents = a.log.filter((l) => l.el === "bedMusic");
  const bedPausedAtPrime = bedEvents.some((l) => l.act === "pause");
  t("bed music keeps buffering, not paused at prime (desktop fix)",
    !bedPausedAtPrime,
    bedEvents.map((e) => e.act).join(">") || "no bed events");
  t("bed music is playing after JOIN",
    a.window.document.getElementById("bedMusic").paused === false,
    "paused=" + a.window.document.getElementById("bedMusic").paused);

  // announcer actually routed through the unlocked element
  await new Promise((r) => setTimeout(r, 400));
  const introPlay = a.log.filter((l) => l.el === "voPlayer" && (l.src || "").indexOf("https://cdn/intro") === 0);
  t("intro announcer plays through the unlocked element",
    introPlay.length > 0, introPlay.length ? "yes" : "NOT PLAYED");

  // ---- 3: replay ----
  const b = makeDom("?id=moL7PcGSqgjE", LIVE);
  await new Promise((r) => setTimeout(r, 120));
  const w = b.window;
  const endScreen = w.document.getElementById("endScreen");
  w.document.getElementById("joinBtn").click();
  await new Promise((r) => setTimeout(r, 100));
  // jump to the end of the show
  w.document.getElementById("replayBtn").click();
  await new Promise((r) => setTimeout(r, 100));
  t("replay leaves the end screen", endScreen.classList.contains("hidden"),
    "endScreen hidden=" + endScreen.classList.contains("hidden"));

  // the old bug: the 3s poll snapped showStart back and re-ended the show.
  // force several poll cycles' worth of time and confirm we're still playing.
  await new Promise((r) => setTimeout(r, 900));
  t("replay survives the state poll (does not snap back to end screen)",
    endScreen.classList.contains("hidden"),
    "endScreen hidden=" + endScreen.classList.contains("hidden"));

  let pass = 0;
  console.log();
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}\n        ${r.detail}`);
    if (r.pass) pass++;
  }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
})();

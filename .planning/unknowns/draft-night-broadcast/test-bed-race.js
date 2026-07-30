/**
 * Regression test for the JOIN-tap pause race, run against the REAL reveal.js.
 *
 * boot()'s JOIN handler primes media under the user gesture and pauses it in a
 * .then(). In demo mode goLive() runs synchronously right after, so the priming
 * promise used to resolve on top of live playback and pause the bed music for
 * the whole show. jsdom gives us real promise ordering; media elements are
 * stubbed because jsdom has no decoder.
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = "/Users/neej/Documents/Projects/FantasyDraftLottery";

function run(revealJsSource, label) {
  const html = fs.readFileSync(path.join(ROOT, "reveal.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost:3000/reveal.html?demo=1" });
  const { window } = dom;

  const log = [];
  // Stub the media API jsdom lacks. play() resolves async — that's the whole point.
  function stubMedia(el, kind) {
    let paused = true;
    el.play = function () {
      paused = false;
      log.push(`${kind}:${el.id || "vid"}:play`);
      return Promise.resolve();
    };
    el.pause = function () {
      paused = true;
      log.push(`${kind}:${el.id || "vid"}:pause`);
    };
    Object.defineProperty(el, "paused", { get: () => paused, configurable: true });
    Object.defineProperty(el, "duration", { get: () => 10, configurable: true });
    el.load = function () {};
  }
  window.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  window.HTMLMediaElement.prototype.pause = function () {};
  window.HTMLMediaElement.prototype.load = function () {};

  Array.from(window.document.querySelectorAll("audio")).forEach((a) => stubMedia(a, "audio"));
  Array.from(window.document.querySelectorAll("video")).forEach((v) => stubMedia(v, "video"));

  // Any Audio() the player constructs for VO clips.
  window.Audio = function (src) {
    const a = window.document.createElement("audio");
    a.id = "vo";
    stubMedia(a, "vo");
    a.src = src;
    return a;
  };
  window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  window.HTMLElement.prototype.scrollIntoView = function () {};

  window.eval(revealJsSource);
  window.document.dispatchEvent(new window.Event("DOMContentLoaded"));

  const bed = window.document.getElementById("bedMusic");
  window.document.getElementById("joinBtn").click();

  return new Promise((resolve) => {
    // Let every primed play() promise settle, the way a real tick would.
    setTimeout(() => {
      resolve({ label, bedPaused: bed.paused, bedVolume: bed.volume, log });
    }, 50);
  });
}

(async () => {
  const current = fs.readFileSync(path.join(ROOT, "reveal.js"), "utf8");

  // Reconstruct the pre-fix handler to show the test actually catches the bug.
  const buggy = current.replace(
    /if \(bp && bp\.then\) bp\.then\(function \(\) \{[\s\S]*?\}\)\.catch\(function \(\) \{ b\.volume = BED_VOLUME; \}\);/,
    "if (bp && bp.then) bp.then(function () { b.pause(); b.volume = BED_VOLUME; }).catch(function () {});"
  );
  if (buggy === current) {
    console.error("!! could not construct the pre-fix variant — test is not meaningful");
    process.exit(2);
  }

  const before = await run(buggy, "pre-fix");
  const after = await run(current, "current reveal.js");

  for (const r of [before, after]) {
    console.log(`\n${r.label}`);
    console.log(`  bedMusic.paused after JOIN : ${r.bedPaused}`);
    console.log(`  bedMusic.volume            : ${r.bedVolume}`);
    console.log(`  media calls: ${r.log.join(" -> ")}`);
  }

  const ok = before.bedPaused === true && after.bedPaused === false;
  console.log(
    `\n${ok ? "PASS" : "FAIL"} — pre-fix silences the bed (${before.bedPaused}), ` +
      `current keeps it playing (${!after.bedPaused})`
  );
  process.exit(ok ? 0 : 1);
})();

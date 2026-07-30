#!/usr/bin/env node
/**
 * Regenerates the landing-page demo VO in broadcast/demo/.
 *
 * Uses the real voScript from api/finalize.js and the real elevenLabsTts from
 * api/_lib.js, so the free sample is rendered by the same code path (and the
 * same voice) a paying commissioner gets. Re-run this after any VO change.
 *
 *   ELEVENLABS_API_KEY=... node tools/gen-demo-vo.js
 */
const fs = require("fs");
const path = require("path");
const { elevenLabsTts, mapWithConcurrency, mp3DurationMs } = require("../api/_lib");
const { voScript } = require("../api/finalize");

// Must stay in sync with DEMO_DATA in reveal.js.
const LEAGUE = "The Gridiron Gang";
const ORDER = [
  "Last Place Larry",
  "The Sleeper Cell",
  "Draft Day Dave",
  "The Waiver Wire Warriors",
  "Kicker Karen",
  "The Benchwarmers",
];

const OUT = path.join(__dirname, "..", "broadcast", "demo");

async function main() {
  if (!process.env.ELEVENLABS_API_KEY) {
    console.error("ELEVENLABS_API_KEY not set");
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });

  const lines = voScript(LEAGUE, ORDER);
  const jobs = [
    { file: "intro.mp3", text: lines.intro },
    { file: "two-remain.mp3", text: lines.twoRemain },
    ...Object.keys(lines.picks).map((p) => ({
      file: `pick-${p}.mp3`,
      text: lines.picks[p],
    })),
  ];

  const started = Date.now();
  const durs = {};
  await mapWithConcurrency(jobs, 3, async (job) => {
    const t0 = Date.now();
    const buf = await elevenLabsTts(job.text);
    fs.writeFileSync(path.join(OUT, job.file), buf);
    durs[job.file] = mp3DurationMs(buf);
    console.log(
      `  ${job.file.padEnd(16)} ${String(buf.length).padStart(7)} bytes  ` +
        `${String(durs[job.file]).padStart(6)}ms  (${Date.now() - t0}ms)`
    );
  });
  console.log(`\n${jobs.length} clips in ${((Date.now() - started) / 1000).toFixed(1)}s`);

  // Paste into DEMO_DATA.audioManifest.dur in reveal.js so the demo is paced
  // by the same numbers a paid show gets from the manifest.
  const picks = {};
  Object.keys(durs)
    .filter((f) => f.startsWith("pick-"))
    .forEach((f) => (picks[Number(f.match(/\d+/)[0])] = durs[f]));
  console.log("\ndur: " + JSON.stringify(
    { intro: durs["intro.mp3"], twoRemain: durs["two-remain.mp3"], picks },
    null, 2
  ));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

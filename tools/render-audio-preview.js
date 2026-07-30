#!/usr/bin/env node
/**
 * Offline render of exactly what the demo broadcast sounds like.
 *
 * The player mixes bed music + announcer live in the browser, so there is no
 * file anywhere that represents the actual soundtrack. This rebuilds that mix
 * with ffmpeg using the same constants reveal.js uses, so the levels can be
 * measured (and listened to) without needing a working browser.
 *
 * Keep the constants below in sync with reveal.js.
 *
 *   node tools/render-audio-preview.js [out.mp3]
 */
const { execFileSync } = require("child_process");
const path = require("path");

// --- mirrors reveal.js ---
const COLD_OPEN = 17000;
const PER_PICK = 12000;
const TWO_REMAIN = 7000;
const FINAL_PICK = 21000;
const BED_VOLUME = 0.28;
const BED_DUCKED = 0.12;
const FINAL_VO_AT = 7500; // finalPick schedules pick1 VO at +7500ms

const ROOT = path.join(__dirname, "..");
const DEMO = path.join(ROOT, "broadcast", "demo");
const BED = path.join(ROOT, "broadcast", "bed-music.mp3");
const N = 6; // demo league size

function dur(file) {
  return parseFloat(
    execFileSync("ffprobe", [
      "-v", "quiet", "-show_entries", "format=duration",
      "-of", "csv=p=0", file,
    ]).toString().trim()
  );
}

// Walk the same timeline buildSegments() produces (gap 0) and note each VO cue.
// Segment sizing mirrors reveal.js's fit(): a slot always outlasts its own VO.
const fit = (base, d, tail) => (d ? Math.max(base, d + tail) : base);

function cues(ms) {
  const out = [];
  let t = 0;
  out.push({ at: t, file: "intro.mp3" });
  t += fit(COLD_OPEN, ms["intro.mp3"], 1500);
  for (let pick = N; pick >= 3; pick--) {
    out.push({ at: t, file: `pick-${pick}.mp3` });
    t += fit(PER_PICK, ms[`pick-${pick}.mp3`], 2500);
  }
  out.push({ at: t, file: "two-remain.mp3" });
  t += fit(TWO_REMAIN, ms["two-remain.mp3"], 1000);
  out.push({ at: t, file: "pick-2.mp3" });
  t += fit(PER_PICK, ms["pick-2.mp3"], 2500);
  out.push({ at: t + FINAL_VO_AT, file: "pick-1.mp3" });
  const slamAt = FINAL_VO_AT + Math.max(0, ms["pick-1.mp3"] - 1500);
  t += Math.max(FINAL_PICK, slamAt + 6500);
  return { cues: out, total: t };
}

function main() {
  const outFile = process.argv[2] || path.join(ROOT, ".planning", "unknowns", "draft-night-broadcast", "demo-mix-preview.mp3");
  const files = ["intro.mp3", "two-remain.mp3", ...Array.from({ length: N }, (_, i) => `pick-${i + 1}.mp3`)];
  const ms = {};
  for (const f of files) ms[f] = Math.round(dur(path.join(DEMO, f)) * 1000);

  const { cues: list, total } = cues(ms);
  const totalSec = total / 1000;

  for (const c of list) c.dur = dur(path.join(DEMO, c.file));

  // Duck windows = whenever a VO clip is sounding.
  const windows = list.map((c) => [c.at / 1000, c.at / 1000 + c.dur]);
  const duckExpr = windows
    .map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`)
    .join("+");

  const inputs = ["-i", BED];
  list.forEach((c) => inputs.push("-i", path.join(DEMO, c.file)));

  const filters = [];
  // Bed: loop to cover the show, then apply the duck envelope.
  filters.push(
    `[0:a]atrim=0:${totalSec},asetpts=N/SR/TB,` +
      `volume=enable='1':volume='if(${duckExpr},${BED_DUCKED},${BED_VOLUME})':eval=frame[bed]`
  );
  list.forEach((c, i) => {
    filters.push(`[${i + 1}:a]adelay=${c.at}|${c.at}[vo${i}]`);
  });
  const voLabels = list.map((_, i) => `[vo${i}]`).join("");
  filters.push(`${voLabels}amix=inputs=${list.length}:normalize=0[vo]`);
  filters.push(`[bed][vo]amix=inputs=2:normalize=0,alimiter=limit=0.95[out]`);

  execFileSync("ffmpeg", [
    "-v", "error", "-y",
    "-stream_loop", "-1", ...inputs.slice(0, 2),
    ...inputs.slice(2),
    "-filter_complex", filters.join(";"),
    "-map", "[out]", "-t", String(totalSec),
    "-c:a", "libmp3lame", "-b:a", "192k",
    outFile,
  ], { stdio: "inherit" });

  console.log(`\nRendered ${outFile}`);
  console.log(`  show length : ${totalSec.toFixed(1)}s`);
  console.log(`  VO cues     : ${list.length}`);
  list.forEach((c) =>
    console.log(`    ${String(c.at).padStart(7)}ms  ${c.file.padEnd(15)} ${c.dur.toFixed(2)}s`)
  );
  // Overrun check: a VO that outlasts its slot talks over the next one.
  for (let i = 0; i < list.length - 1; i++) {
    const end = list[i].at + list[i].dur * 1000;
    if (end > list[i + 1].at) {
      console.log(
        `  !! OVERLAP: ${list[i].file} ends ${Math.round(end)}ms but ` +
          `${list[i + 1].file} starts ${list[i + 1].at}ms`
      );
    }
  }
}

main();

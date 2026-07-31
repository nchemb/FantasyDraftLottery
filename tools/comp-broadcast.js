#!/usr/bin/env node
/**
 * Create a Draft Night broadcast without going through Stripe.
 *
 * Runs the same seal that api/finalize.js runs after a payment: generateOrder,
 * the real voScript, real ElevenLabs TTS, real storage upload, and the same
 * commitment hash. The result is indistinguishable from a paid broadcast, so
 * this is the tool for comping a league, running your own, or re-sealing a row
 * whose audio failed. Local only -- it needs the service key, so there is no
 * public endpoint and no new attack surface.
 *
 *   node tools/comp-broadcast.js league.json
 *
 * league.json:
 *   {
 *     "leagueName": "My League",
 *     "weighted": true,
 *     "teams": [{ "name": "Team A", "weight": 250 }, ...],
 *     "scheduledAt": "2026-07-30T23:30:00-05:00",   // omit for manual start
 *     "pickGapSeconds": 0                            // 0 | 30 | 60 | 120 | 300
 *   }
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const {
  sbInsert, sbUpdate, generateOrder, commitmentHash, newRevealId, newHostToken,
  validateInput, elevenLabsTts, mp3DurationMs, mapWithConcurrency, storageUpload,
} = require(ROOT + "/api/_lib");
const { voScript } = require(ROOT + "/api/finalize");

const SITE = process.env.COMP_SITE_URL || "https://www.fantasydraftlottery.com";
const GAPS = [0, 30, 60, 120, 300];

async function main() {
  const cfgPath = process.argv[2];
  if (!cfgPath) { console.error("usage: node tools/comp-broadcast.js <league.json>"); process.exit(1); }
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));

  // Same validation the paid endpoint applies, so a comp can't create a row
  // the player would choke on.
  const parsed = validateInput(cfg);
  if (parsed.error) { console.error("invalid league:", parsed.error); process.exit(1); }

  const gap = Number(cfg.pickGapSeconds || 0);
  if (!GAPS.includes(gap)) { console.error("pickGapSeconds must be one of", GAPS.join(", ")); process.exit(1); }

  let scheduledAt = null;
  if (cfg.scheduledAt) {
    const t = Date.parse(cfg.scheduledAt);
    if (!Number.isFinite(t)) { console.error("scheduledAt didn't parse"); process.exit(1); }
    if (t < Date.now()) { console.error("scheduledAt is in the past"); process.exit(1); }
    scheduledAt = new Date(t).toISOString();
  }

  const row = await sbInsert({
    reveal_id: newRevealId(),
    league_name: parsed.leagueName,
    teams: parsed.teams,
    weighted: parsed.weighted,
    host_token: newHostToken(),
    scheduled_at: scheduledAt,
    pick_gap_seconds: gap,
  });

  const order = generateOrder(row.teams, row.weighted);
  const lines = voScript(row.league_name, order);
  const prefix = `${row.reveal_id}/${crypto.randomBytes(6).toString("base64url")}`;
  const manifest = { picks: {}, dur: { picks: {} } };
  const jobs = [
    { f: "intro.mp3", t: lines.intro, set: (u, ms) => { manifest.intro = u; manifest.dur.intro = ms; } },
    { f: "two-remain.mp3", t: lines.twoRemain, set: (u, ms) => { manifest.twoRemain = u; manifest.dur.twoRemain = ms; } },
    ...Object.keys(lines.picks).map((p) => ({
      f: `pick-${p}.mp3`, t: lines.picks[p],
      set: (u, ms) => { manifest.picks[p] = u; manifest.dur.picks[p] = ms; },
    })),
  ];

  process.stdout.write(`generating ${jobs.length} announcer clips`);
  const t0 = Date.now();
  await mapWithConcurrency(jobs, 4, async (j) => {
    const buf = await elevenLabsTts(j.t);
    j.set(await storageUpload(`${prefix}/${j.f}`, buf, "audio/mpeg"), mp3DurationMs(buf));
    process.stdout.write(".");
  });
  console.log(` done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const salt = crypto.randomBytes(16).toString("hex");
  await sbUpdate(`id=eq.${row.id}&sealed=eq.false`, {
    draft_order: order, salt, commitment_hash: commitmentHash(order, salt),
    sealed: true, sealed_at: new Date().toISOString(), status: "sealed",
    audio_manifest: manifest,
  });

  // Runtime mirrors buildSegments(): 45s of fixed segments, then per-pick + gap.
  const perPick = order.length > 16 ? 11 : 12;
  const runtime = 45 + (order.length - 1) * perPick + (order.length - 1) * gap;
  const mins = Math.round(runtime / 60);

  console.log("\n" + "=".repeat(64));
  console.log(`  ${row.league_name} — SEALED`);
  console.log("=".repeat(64));
  console.log(`  teams        : ${order.length}${row.weighted ? " (weighted)" : ""}`);
  console.log(`  showtime     : ${scheduledAt ? new Date(scheduledAt).toLocaleString() : "manual — you press start"}`);
  console.log(`  pacing       : ${gap ? gap + "s between picks" : "rapid fire"}`);
  console.log(`  runtime      : ~${mins} min`);
  console.log(`  proof        : ${commitmentHash(order, salt).slice(0, 24)}…`);
  console.log("\n  SHARE WITH YOUR LEAGUE (no spoilers, no controls):");
  console.log(`  ${SITE}/reveal.html?id=${row.reveal_id}`);
  console.log("\n  YOUR COMMISSIONER LINK (keep private — carries the controls):");
  console.log(`  ${SITE}/reveal.html?id=${row.reveal_id}&host=${encodeURIComponent(row.host_token)}`);
  console.log("\n  The order is sealed and nobody can see it until showtime — including you.");
  console.log("=".repeat(64) + "\n");
}

main().catch((err) => { console.error(err); process.exit(1); });

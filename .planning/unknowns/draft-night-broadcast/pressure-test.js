/**
 * Pressure test: 4 league shapes end to end against the real API + real seal path.
 *
 * The card form itself is not re-driven here (already proven twice, and the
 * hosted page only mints its PaymentIntent on submit). Everything downstream of
 * "payment succeeded" runs the exact production code: generateOrder, the real
 * voScript, real ElevenLabs TTS, real storage upload, real reveal/reveal-state
 * endpoints, and reveal.js's own segment sizing replayed over measured durations.
 */
const ROOT = "/Users/neej/Documents/Projects/FantasyDraftLottery";
const fs = require("fs");
const path = require("path");
// load .env by hand (no deps in this project)
for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const {
  sbSelect, sbUpdate, generateOrder, commitmentHash,
  elevenLabsTts, mp3DurationMs, mapWithConcurrency, storageUpload,
} = require(ROOT + "/api/_lib");
const { voScript } = require(ROOT + "/api/finalize");
const crypto = require("crypto");

const BASE = "http://localhost:3000";

// ---- mirrors reveal.js ----
const COLD_OPEN = 17000, PER_PICK = 12000, PER_PICK_QUICK = 11000;
const TWO_REMAIN = 7000, FINAL_PICK = 21000, FINAL_VO_AT = 7500;
const fit = (base, d, tail) => (d ? Math.max(base, d + tail) : base);

function buildSegments(order, gapSeconds, dur) {
  const n = order.length;
  const perPick = n > 16 ? PER_PICK_QUICK : PER_PICK;
  const gapMs = (gapSeconds || 0) * 1000;
  const segs = [];
  let t = 0;
  const vo = (k, p) => (!dur ? 0 : k === "pick" ? (dur.picks && dur.picks[p]) || 0 : dur[k] || 0);
  function pushGap() {
    if (!gapMs) return;
    let remaining = gapMs;
    while (remaining > 0) {
      const d = Math.min(10000, remaining);
      segs.push({ start: t, dur: d, type: "atmo" });
      t += d; remaining -= d;
    }
  }
  let d = fit(COLD_OPEN, vo("intro"), 1500);
  segs.push({ start: t, dur: d, type: "coldOpen", voKey: "intro" }); t += d;
  for (let pick = n; pick >= 3; pick--) {
    d = fit(perPick, vo("pick", pick), 2500);
    segs.push({ start: t, dur: d, type: "pick", pick, voKey: "pick" + pick }); t += d;
    pushGap();
  }
  d = fit(TWO_REMAIN, vo("twoRemain"), 1000);
  segs.push({ start: t, dur: d, type: "twoRemain", voKey: "twoRemain" }); t += d;
  if (n >= 2) {
    d = fit(perPick, vo("pick", 2), 2500);
    segs.push({ start: t, dur: d, type: "pick", pick: 2, voKey: "pick2" }); t += d;
    pushGap();
  }
  const finalVo = vo("pick", 1);
  const slamAt = finalVo ? FINAL_VO_AT + Math.max(0, finalVo - 1500) : 14500;
  d = Math.max(FINAL_PICK, slamAt + 6500);
  segs.push({ start: t, dur: d, type: "finalPick", pick: 1, slamAt, voAt: FINAL_VO_AT }); t += d;
  return { segs, total: t, slamAt, perPick };
}

// ---- the real seal, minus Stripe ----
async function seal(row) {
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
  const t0 = Date.now();
  await mapWithConcurrency(jobs, 4, async (j) => {
    const buf = await elevenLabsTts(j.t);
    j.set(await storageUpload(`${prefix}/${j.f}`, buf, "audio/mpeg"), mp3DurationMs(buf));
  });
  const ms = Date.now() - t0;
  const salt = crypto.randomBytes(16).toString("hex");
  const updated = await sbUpdate(`id=eq.${row.id}&sealed=eq.false`, {
    draft_order: order, salt, commitment_hash: commitmentHash(order, salt),
    sealed: true, sealed_at: new Date().toISOString(), status: "sealed",
    audio_manifest: manifest,
  });
  return { order, manifest, ms, clips: jobs.length, sealedRow: updated[0] };
}

const CASES = [
  { name: "C1 2-team manual rapid", teams: 2, gap: 0, mode: "manual", weighted: false },
  { name: "C2 12-team SCHEDULED 30s", teams: 12, gap: 30, mode: "scheduled", weighted: true },
  { name: "C3 20-team manual 60s", teams: 20, gap: 60, mode: "manual", weighted: false },
  { name: "C4 32-team manual 300s", teams: 32, gap: 300, mode: "manual", weighted: true },
];

function mkTeams(n, weighted) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    out.push({ name: `PT Team ${i}` + (i === 1 ? " José Muñoz" : ""), weight: weighted ? (n - i + 1) * 3 : 1 });
  }
  return out;
}

const results = [];
function chk(r, label, pass, detail) {
  r.checks.push({ label, pass, detail: detail || "" });
}

(async () => {
  for (const c of CASES) {
    const r = { name: c.name, checks: [] };
    results.push(r);
    console.log(`\n===== ${c.name} =====`);

    const teams = mkTeams(c.teams, c.weighted);
    const scheduledAt = c.mode === "scheduled" ? new Date(Date.now() + 45000).toISOString() : null;

    // 1. real checkout endpoint
    const res = await fetch(`${BASE}/api/checkout`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leagueName: `PT ${c.teams}team ${c.gap}s`,
        teams, weighted: c.weighted, scheduledAt, pickGapSeconds: c.gap,
      }),
    });
    const body = await res.json();
    chk(r, "checkout 200 + stripe url", res.ok && !!body.url, body.error || (body.url || "").slice(0, 40));
    if (!body.url) { console.log("  ABORT: no checkout url"); continue; }

    // find the row checkout just made
    const rows = await (await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/fdl_reveals?league_name=eq.${encodeURIComponent(`PT ${c.teams}team ${c.gap}s`)}&order=created_at.desc&limit=1`,
      { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } }
    )).json();
    const row = rows[0];
    chk(r, "row created", !!row, row && row.reveal_id);
    if (!row) continue;
    r.revealId = row.reveal_id;
    r.hostToken = row.host_token;

    chk(r, "teams persisted", row.teams.length === c.teams, `${row.teams.length}/${c.teams}`);
    chk(r, "gap persisted", row.pick_gap_seconds === c.gap, String(row.pick_gap_seconds));
    chk(r, "mode persisted", c.mode === "scheduled" ? !!row.scheduled_at : !row.scheduled_at,
      row.scheduled_at || "manual");

    // 2. spoiler gate BEFORE seal
    let rv = await (await fetch(`${BASE}/api/reveal?id=${row.reveal_id}`)).json();
    chk(r, "pre-seal: no order leaked", !rv.draftOrder, JSON.stringify(rv.draftOrder || null));

    // 3. the real seal
    const s = await seal(row);
    r.sealMs = s.ms; r.clips = s.clips;
    chk(r, "seal produced full order", s.order.length === c.teams, `${s.order.length} picks`);
    chk(r, "every team exactly once",
      new Set(s.order).size === c.teams && teams.every((t) => s.order.includes(t.name)), "");
    chk(r, `TTS ${s.clips} clips under 60s budget`, s.ms < 60000, `${(s.ms / 1000).toFixed(1)}s`);
    const nAudio = Object.keys(s.manifest.picks).length;
    chk(r, "audio: one clip per pick + intro + twoRemain",
      nAudio === c.teams && !!s.manifest.intro && !!s.manifest.twoRemain, `${nAudio} picks`);
    const nDur = Object.keys(s.manifest.dur.picks).length;
    chk(r, "durations recorded for every clip",
      nDur === c.teams && s.manifest.dur.intro > 0 && s.manifest.dur.twoRemain > 0, `${nDur} durs`);

    // 4. timeline: nothing may overrun its slot
    const tl = buildSegments(s.order, c.gap, s.manifest.dur);
    let overruns = [];
    for (const seg of tl.segs) {
      if (!seg.voKey) continue;
      const d = seg.voKey === "intro" ? s.manifest.dur.intro
        : seg.voKey === "twoRemain" ? s.manifest.dur.twoRemain
        : s.manifest.dur.picks[seg.voKey.replace("pick", "")];
      if (d && d > seg.dur) overruns.push(`${seg.voKey} ${d}>${seg.dur}`);
    }
    const fp = tl.segs.find((x) => x.type === "finalPick");
    const finalEnd = fp.voAt + s.manifest.dur.picks["1"];
    if (finalEnd > fp.dur) overruns.push(`finalPick ${finalEnd}>${fp.dur}`);
    chk(r, "no VO overruns its segment", overruns.length === 0, overruns.join(", "));
    chk(r, "confetti lands on the name",
      fp.slamAt <= finalEnd && fp.slamAt >= finalEnd - 3000,
      `slam +${(fp.slamAt / 1000).toFixed(1)}s vs VO end +${(finalEnd / 1000).toFixed(1)}s`);

    const atmo = tl.segs.filter((x) => x.type === "atmo");
    const expectedGaps = c.gap > 0 ? c.teams - 1 : 0;
    const gapChunks = c.gap > 0 ? Math.ceil(c.gap / 10) * expectedGaps : 0;
    chk(r, "pacing gaps inserted", atmo.length === gapChunks, `${atmo.length} atmo chunks (want ${gapChunks})`);
    chk(r, "quick mode past 16 teams",
      tl.perPick === (c.teams > 16 ? PER_PICK_QUICK : PER_PICK), `${tl.perPick}ms/pick`);
    r.showLen = tl.total;

    // 5. host auth
    const post = (b) => fetch(`${BASE}/api/reveal-state`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b),
    });
    chk(r, "no token rejected", (await post({ id: row.reveal_id, action: "start" })).status === 403);
    chk(r, "wrong token rejected", (await post({ id: row.reveal_id, hostToken: "nope", action: "start" })).status === 403);

    // 6. gating around showtime
    rv = await (await fetch(`${BASE}/api/reveal?id=${row.reveal_id}`)).json();
    if (c.mode === "scheduled") {
      chk(r, "scheduled: sealed but still hidden", !rv.draftOrder && rv.live === false, `live=${rv.live}`);
      const waitMs = Date.parse(row.scheduled_at) - Date.now() + 3000;
      console.log(`  waiting ${Math.max(0, waitMs / 1000).toFixed(0)}s for scheduled showtime...`);
      if (waitMs > 0) await new Promise((ok) => setTimeout(ok, waitMs));
      rv = await (await fetch(`${BASE}/api/reveal?id=${row.reveal_id}`)).json();
      chk(r, "scheduled: auto-live at showtime", rv.live === true && !!rv.draftOrder, `live=${rv.live}`);
    } else {
      chk(r, "manual: hidden before start", !rv.draftOrder && rv.live === false, `live=${rv.live}`);
      const st = await post({ id: row.reveal_id, hostToken: row.host_token, action: "start" });
      chk(r, "host start accepted", st.status === 200);
      await new Promise((ok) => setTimeout(ok, 1200));
      rv = await (await fetch(`${BASE}/api/reveal?id=${row.reveal_id}`)).json();
      chk(r, "manual: live after start", rv.live === true && !!rv.draftOrder, `live=${rv.live}`);
      chk(r, "re-start rejected 409",
        (await post({ id: row.reveal_id, hostToken: row.host_token, action: "start" })).status === 409);
    }
    chk(r, "post-showtime order matches seal",
      JSON.stringify(rv.draftOrder) === JSON.stringify(s.order), "");
    chk(r, "post-showtime audio delivered",
      !!rv.audioManifest && Object.keys(rv.audioManifest.picks || {}).length === c.teams, "");
    chk(r, "gap delivered to client", rv.pickGapSeconds === c.gap, String(rv.pickGapSeconds));

    const passed = r.checks.filter((x) => x.pass).length;
    console.log(`  ${passed}/${r.checks.length} checks passed · seal ${(s.ms / 1000).toFixed(1)}s · show ${(tl.total / 60000).toFixed(1)}min`);
    for (const x of r.checks) if (!x.pass) console.log(`   FAIL: ${x.label} — ${x.detail}`);
  }

  console.log("\n\n================ SUMMARY ================");
  let allPass = true;
  for (const r of results) {
    const p = r.checks.filter((x) => x.pass).length, n = r.checks.length;
    if (p !== n) allPass = false;
    console.log(`${p === n ? "PASS" : "FAIL"}  ${r.name.padEnd(26)} ${p}/${n}` +
      (r.sealMs ? `  seal ${(r.sealMs / 1000).toFixed(1)}s/${r.clips} clips  show ${(r.showLen / 60000).toFixed(1)}min` : ""));
    for (const x of r.checks) if (!x.pass) console.log(`        FAIL ${x.label} — ${x.detail}`);
  }
  console.log(allPass ? "\nALL CASES PASS" : "\nFAILURES PRESENT");
  fs.writeFileSync("/tmp/fdl_pressure.json", JSON.stringify(results, null, 2));
  process.exit(allPass ? 0 : 1);
})();

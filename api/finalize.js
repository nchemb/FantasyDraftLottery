const {
  sbSelect,
  sbUpdate,
  stripe,
  generateOrder,
  commitmentHash,
  ORDINALS,
  sanitizeForVO,
  elevenLabsTts,
  mapWithConcurrency,
  storageUpload,
} = require("./_lib");
const crypto = require("crypto");

// Account concurrency cap is 5 (measured: 6 in flight returns 429). 4 leaves
// headroom for retries and renders a 32-team league (34 clips, ~3.5s each) in
// roughly 30s — inside the 60s function budget set in vercel.json.
const TTS_CONCURRENCY = 4;

function errorPage(res, code, message) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(code).send(
    `<!doctype html><html><head><title>Fantasy Draft Lottery</title></head>` +
      `<body style="font-family:sans-serif;background:#0b1220;color:#fff;text-align:center;padding:4rem 1rem;">` +
      `<h1>Something went wrong</h1><p>${message}</p>` +
      `<p>If you were charged, your broadcast is safe — email <a style="color:#f5c542" href="mailto:nchemb@gmail.com">nchemb@gmail.com</a> with your league name and we'll sort it out.</p>` +
      `<p><a style="color:#f5c542" href="/">Back to Fantasy Draft Lottery</a></p></body></html>`
  );
}

// "The Gridiron Gang" would otherwise read as "in the The Gridiron Gang draft".
function leagueForVO(leagueName) {
  return sanitizeForVO(leagueName).replace(/^the\s+/i, "");
}

function voScript(leagueName, order) {
  const league = leagueForVO(leagueName);
  const n = order.length;
  // Bracketed [tags] are eleven_v3 delivery cues — they steer the read and are
  // never spoken. sanitizeForVO strips brackets, so a team name can't inject one.
  const lines = {
    intro: `[announcer] LIVE, from the Fantasy Draft Lottery studios... [excited] IT'S DRAFT NIGHT! ${n} teams. One dream. [dramatic] The commissioner has reached the podium... and the order... is SEALED. [shouting] Let's begin!`,
    twoRemain: "[dramatic] TWO teams remain... [slowly] Only ONE... can pick first.",
    picks: {},
  };
  // order[0] = #1 overall ... order[n-1] = last pick; announced bottom-up, keyed by pick number.
  // Caps + ellipses drive the announcer delivery: pause before the name, punch on it.
  for (let pick = n; pick >= 2; pick--) {
    const team = sanitizeForVO(order[pick - 1]).toUpperCase();
    lines.picks[pick] = `[announcer] With the ${ORDINALS[pick]} pick... in the ${league} draft... the league selects... [emphatic] ${team}!`;
  }
  lines.picks[1] = `[announcer] And now... [dramatic] with the FIRST OVERALL PICK... in the ${league} draft... [building tension] the league selects... [shouting] ${sanitizeForVO(order[0]).toUpperCase()}!`;
  return lines;
}

// Generates every announcer line in parallel and uploads the MP3s.
// Any failure returns null: the broadcast then plays chyron-only and the row can be regenerated.
async function generateAudioManifest(row, order) {
  if (!process.env.ELEVENLABS_API_KEY) return null;
  try {
    const lines = voScript(row.league_name, order);
    const prefix = `${row.reveal_id}/${crypto.randomBytes(6).toString("base64url")}`;
    const manifest = { picks: {} };

    const jobs = [
      { file: "intro.mp3", text: lines.intro, set: (url) => (manifest.intro = url) },
      { file: "two-remain.mp3", text: lines.twoRemain, set: (url) => (manifest.twoRemain = url) },
    ];
    for (const pick of Object.keys(lines.picks)) {
      jobs.push({
        file: `pick-${pick}.mp3`,
        text: lines.picks[pick],
        set: (url) => (manifest.picks[pick] = url),
      });
    }

    // Bounded pool, not Promise.all: 32 teams = 34 clips, and firing them all
    // at once trips the ElevenLabs concurrency cap.
    await mapWithConcurrency(jobs, TTS_CONCURRENCY, async (job) => {
      const buf = await elevenLabsTts(job.text);
      job.set(await storageUpload(`${prefix}/${job.file}`, buf, "audio/mpeg"));
    });
    return manifest;
  } catch (err) {
    console.error("TTS generation failed (broadcast will run chyron-only):", err);
    return null;
  }
}

module.exports = async function handler(req, res) {
  const sessionId = req.query && req.query.session_id;
  if (!sessionId) return errorPage(res, 400, "Missing checkout session.");

  try {
    const session = await stripe(`checkout/sessions/${encodeURIComponent(sessionId)}`);

    if (session.payment_status !== "paid") {
      return errorPage(res, 402, "Payment not completed. Your card was not charged.");
    }

    const uuid = session.metadata && session.metadata.reveal_uuid;
    if (!uuid) return errorPage(res, 400, "Broadcast not found for this payment.");

    let row = await sbSelect(`id=eq.${uuid}`);
    if (!row) return errorPage(res, 404, "Broadcast not found.");

    if (!row.sealed) {
      const order = generateOrder(row.teams, row.weighted);
      const salt = crypto.randomBytes(16).toString("hex");
      const audioManifest = await generateAudioManifest(row, order);
      // Guarded update: only seals if still unsealed, so a double-visit can never re-roll.
      const updated = await sbUpdate(`id=eq.${uuid}&sealed=eq.false`, {
        draft_order: order,
        salt: salt,
        commitment_hash: commitmentHash(order, salt),
        sealed: true,
        sealed_at: new Date().toISOString(),
        status: "sealed",
        audio_manifest: audioManifest,
      });
      row = updated[0] || (await sbSelect(`id=eq.${uuid}`));
    }

    res.setHeader(
      "Location",
      `/reveal.html?id=${row.reveal_id}&host=${encodeURIComponent(row.host_token || "")}&new=1`
    );
    return res.status(302).end();
  } catch (err) {
    console.error("Finalize error:", err);
    return errorPage(res, 500, "We hit a snag finalizing your broadcast.");
  }
};

// Exposed so tools/gen-demo-vo.js renders the landing-page demo through the
// exact same script the paid broadcast uses; the sample can't drift from prod.
module.exports.voScript = voScript;

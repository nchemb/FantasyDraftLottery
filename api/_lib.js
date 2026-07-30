const crypto = require("crypto");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function sbHeaders(extra) {
  return Object.assign(
    {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    extra || {}
  );
}

async function sbSelect(filter) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/fdl_reveals?${filter}&limit=1`,
    { headers: sbHeaders() }
  );
  if (!r.ok) throw new Error(`Supabase select failed: ${r.status}`);
  const rows = await r.json();
  return rows[0] || null;
}

async function sbInsert(row) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/fdl_reveals`, {
    method: "POST",
    headers: sbHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`Supabase insert failed: ${r.status} ${await r.text()}`);
  return (await r.json())[0];
}

async function sbUpdate(filter, patch) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/fdl_reveals?${filter}`, {
    method: "PATCH",
    headers: sbHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`Supabase update failed: ${r.status} ${await r.text()}`);
  return await r.json();
}

async function stripe(path, params) {
  const opts = { headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } };
  if (params) {
    opts.method = "POST";
    opts.headers["Content-Type"] = "application/x-www-form-urlencoded";
    opts.body = new URLSearchParams(params).toString();
  }
  const r = await fetch(`https://api.stripe.com/v1/${path}`, opts);
  const data = await r.json();
  if (!r.ok) {
    const msg = data && data.error ? data.error.message : `status ${r.status}`;
    throw new Error(`Stripe ${path} failed: ${msg}`);
  }
  return data;
}

// Uniform crypto-random Fisher-Yates
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Lottery-ball semantics: each remaining team's chance of the next pick is
// proportional to its ball count, drawn without replacement.
function weightedDraw(teams) {
  const pool = teams.slice();
  const order = [];
  while (pool.length) {
    const total = pool.reduce((s, t) => s + t.weight, 0);
    let r = crypto.randomInt(total);
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i].weight;
      if (r < 0) {
        idx = i;
        break;
      }
    }
    order.push(pool[idx].name);
    pool.splice(idx, 1);
  }
  return order;
}

function generateOrder(teams, weighted) {
  return weighted
    ? weightedDraw(teams)
    : shuffle(teams.map((t) => t.name));
}

function newRevealId() {
  return crypto.randomBytes(9).toString("base64url");
}

function newHostToken() {
  return crypto.randomBytes(16).toString("base64url");
}

const ORDINALS = [
  "", "first", "second", "third", "fourth", "fifth", "sixth", "seventh",
  "eighth", "ninth", "tenth", "eleventh", "twelfth", "thirteenth",
  "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth",
  "nineteenth", "twentieth", "twenty-first", "twenty-second",
  "twenty-third", "twenty-fourth", "twenty-fifth", "twenty-sixth",
  "twenty-seventh", "twenty-eighth", "twenty-ninth", "thirtieth",
  "thirty-first", "thirty-second",
];

// VO only ever speaks a cleaned version of a team name; the board shows the raw one.
// Letters are matched as \p{L}/\p{M}, NOT \w — \w is ASCII-only, so it ate the
// accents and turned "José" into "JOS" and "Señor Muñoz" into "SE OR MU OZ"
// while the board still displayed them correctly. Brackets stay excluded so a
// team name can never inject an eleven_v3 delivery tag.
function sanitizeForVO(name) {
  return name
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "")
    .replace(/[^\p{L}\p{M}\p{N}\s.,'!&-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim() || "this team";
}

// "Tyler - Energetic Arena Announcer" — deep, punchy, arena PA delivery.
// Chosen over 5 other announcer voices on measured pitch spread + loudness range
// (see .planning/unknowns/draft-night-broadcast/voice-selection.md).
const DEFAULT_VOICE_ID = "GyIXYY876myKNtA1j8NI";

// eleven_v3 honours the inline [tags] in voScript. stability 0.5 ("Natural")
// beat 0.0 ("Creative") on drama AND keeps the same announcer across calls —
// each pick is its own request, so per-call drift would be audible.
async function elevenLabsTts(text) {
  const key = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
  if (!key) throw new Error("ELEVENLABS_API_KEY not set");

  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          model_id: "eleven_v3",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            use_speaker_boost: true,
          },
        }),
      }
    );
    if (r.ok) return Buffer.from(await r.arrayBuffer());
    lastErr = `ElevenLabs failed: ${r.status} ${await r.text()}`;
    // 429 = concurrency cap, 5xx = transient. Both are worth backing off for.
    if (r.status !== 429 && r.status < 500) break;
    await new Promise((ok) => setTimeout(ok, 800 * Math.pow(2, attempt)));
  }
  throw new Error(lastErr);
}

// We request mp3_44100_128, which is constant bitrate, so byte length gives the
// duration outright: 128kbit/s = 16000 bytes/s. Measured against ffprobe across
// clips of 8-13s this runs 50-80ms long (the header), i.e. it never under-reports,
// which is the safe direction for sizing a segment. Lets the player fit the
// timeline to the real audio without shipping an audio decoder into a function.
function mp3DurationMs(buf) {
  return Math.round((buf.length / 16000) * 1000);
}

// Runs jobs with a bounded worker pool. A 32-team league is 33 TTS calls;
// firing them all at once trips the account concurrency cap and loses the
// whole manifest, so the show falls back to chyron-only for no good reason.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );
  return results;
}

async function storageUpload(path, buf, contentType) {
  const r = await fetch(
    `${SUPABASE_URL}/storage/v1/object/fdl-audio/${path}`,
    {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": contentType,
        "x-upsert": "true",
      },
      body: buf,
    }
  );
  if (!r.ok) throw new Error(`Storage upload failed: ${r.status} ${await r.text()}`);
  return `${SUPABASE_URL}/storage/v1/object/public/fdl-audio/${path}`;
}

// The moment the broadcast becomes watchable: the scheduled time, or when the host hit start.
function showStartOf(row) {
  if (row.scheduled_at) return new Date(row.scheduled_at).getTime();
  const bs = row.broadcast_state || {};
  if (bs.started && bs.startedAt) return new Date(bs.startedAt).getTime();
  return null;
}

function commitmentHash(order, salt) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(order) + salt)
    .digest("hex");
}

function validateInput(body) {
  const leagueName = typeof body.leagueName === "string" ? body.leagueName.trim().slice(0, 100) : "";
  const weighted = body.weighted === true;
  const rawTeams = Array.isArray(body.teams) ? body.teams : [];
  if (!leagueName) return { error: "League name required" };
  if (rawTeams.length < 2 || rawTeams.length > 32)
    return { error: "Between 2 and 32 teams required" };
  const teams = [];
  for (const t of rawTeams) {
    const name = t && typeof t.name === "string" ? t.name.trim().slice(0, 50) : "";
    if (!name) return { error: "Every team needs a name" };
    let weight = 1;
    if (weighted) {
      weight = Math.floor(Number(t.weight));
      if (!Number.isFinite(weight) || weight < 1 || weight > 1000)
        return { error: "Weights must be between 1 and 1000" };
    }
    teams.push({ name, weight });
  }
  return { leagueName, teams, weighted };
}

module.exports = {
  SUPABASE_URL,
  sbHeaders,
  sbSelect,
  sbInsert,
  sbUpdate,
  stripe,
  generateOrder,
  newRevealId,
  newHostToken,
  commitmentHash,
  validateInput,
  ORDINALS,
  sanitizeForVO,
  elevenLabsTts,
  mp3DurationMs,
  mapWithConcurrency,
  storageUpload,
  showStartOf,
};

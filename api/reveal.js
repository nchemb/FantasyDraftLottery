const { sbSelect, showStartOf } = require("./_lib");

// Public broadcast data. The draft order and announcer audio stay hidden until showtime:
// that gate is the product promise — nobody, including the commissioner, sees the order early.
module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const id = req.query && req.query.id;
  if (!id || !/^[A-Za-z0-9_-]{6,24}$/.test(id)) {
    return res.status(400).json({ error: "Invalid reveal id" });
  }

  try {
    const row = await sbSelect(
      `reveal_id=eq.${encodeURIComponent(id)}&sealed=eq.true`
    );
    if (!row) return res.status(404).json({ error: "Broadcast not found" });

    const showStart = showStartOf(row);
    const live = showStart !== null && Date.now() >= showStart;

    const payload = {
      leagueName: row.league_name,
      teams: row.teams.map((t) => t.name),
      teamCount: row.teams.length,
      weighted: row.weighted,
      sealedAt: row.sealed_at,
      commitmentHash: row.commitment_hash,
      revealId: row.reveal_id,
      mode: row.scheduled_at ? "scheduled" : "manual",
      scheduledAt: row.scheduled_at,
      pickGapSeconds: row.pick_gap_seconds || 0,
      showStartedAt: showStart ? new Date(showStart).toISOString() : null,
      serverNow: new Date().toISOString(),
      live,
    };

    if (live) {
      payload.draftOrder = row.draft_order;
      payload.audioManifest = row.audio_manifest || null;
    }

    return res.status(200).json(payload);
  } catch (err) {
    console.error("Reveal fetch error:", err);
    return res.status(500).json({ error: "Could not load broadcast" });
  }
};

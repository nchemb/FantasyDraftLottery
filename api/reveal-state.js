const { sbSelect, sbUpdate, showStartOf } = require("./_lib");

// GET  ?id=<reveal_id>                        → { mode, scheduledAt, showStartedAt, serverNow }
// POST { id, hostToken, action, scheduledAt } → host-only controls (start now / move showtime)
module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    const id = req.query && req.query.id;
    if (!id || !/^[A-Za-z0-9_-]{6,24}$/.test(id)) {
      return res.status(400).json({ error: "Invalid reveal id" });
    }
    try {
      const row = await sbSelect(`reveal_id=eq.${encodeURIComponent(id)}&sealed=eq.true`);
      if (!row) return res.status(404).json({ error: "Broadcast not found" });
      const showStart = showStartOf(row);
      return res.status(200).json({
        mode: row.scheduled_at ? "scheduled" : "manual",
        scheduledAt: row.scheduled_at,
        showStartedAt: showStart ? new Date(showStart).toISOString() : null,
        serverNow: new Date().toISOString(),
      });
    } catch (err) {
      console.error("reveal-state GET error:", err);
      return res.status(500).json({ error: "Could not load broadcast state" });
    }
  }

  if (req.method === "POST") {
    const body = req.body || {};
    const id = body.id;
    const hostToken = body.hostToken;
    if (!id || !/^[A-Za-z0-9_-]{6,24}$/.test(id)) {
      return res.status(400).json({ error: "Invalid reveal id" });
    }
    if (!hostToken || typeof hostToken !== "string") {
      return res.status(403).json({ error: "Host token required" });
    }
    try {
      const row = await sbSelect(`reveal_id=eq.${encodeURIComponent(id)}&sealed=eq.true`);
      if (!row) return res.status(404).json({ error: "Broadcast not found" });
      if (!row.host_token || row.host_token !== hostToken) {
        return res.status(403).json({ error: "Only the commissioner can control the broadcast" });
      }
      if (showStartOf(row) && Date.now() >= showStartOf(row)) {
        return res.status(409).json({ error: "The broadcast already started" });
      }

      if (body.action === "start") {
        await sbUpdate(`id=eq.${row.id}`, {
          scheduled_at: null,
          broadcast_state: { started: true, startedAt: new Date().toISOString() },
        });
        return res.status(200).json({ ok: true, showStartedAt: new Date().toISOString() });
      }

      if (body.action === "pacing") {
        const GAP_CHOICES = [0, 30, 60, 120, 300];
        const gap = Number(body.pickGapSeconds);
        if (!GAP_CHOICES.includes(gap)) {
          return res.status(400).json({ error: "Invalid pick pacing" });
        }
        await sbUpdate(`id=eq.${row.id}`, { pick_gap_seconds: gap });
        return res.status(200).json({ ok: true, pickGapSeconds: gap });
      }

      if (body.action === "schedule") {
        const t = Date.parse(body.scheduledAt);
        if (!Number.isFinite(t) || t < Date.now() - 60 * 1000) {
          return res.status(400).json({ error: "Pick a time in the future" });
        }
        await sbUpdate(`id=eq.${row.id}`, {
          scheduled_at: new Date(t).toISOString(),
          broadcast_state: { started: false, startedAt: null },
        });
        return res.status(200).json({ ok: true, scheduledAt: new Date(t).toISOString() });
      }

      return res.status(400).json({ error: "Unknown action" });
    } catch (err) {
      console.error("reveal-state POST error:", err);
      return res.status(500).json({ error: "Could not update broadcast" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
};

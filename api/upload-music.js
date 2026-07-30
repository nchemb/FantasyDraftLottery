const { SUPABASE_URL, sbHeaders, sbSelect, sbUpdate } = require("./_lib");

// Two-step flow so the MP3 never passes through this function (Vercel body cap):
//   1. {action:"sign", revealId}   -> signed Supabase Storage upload URL
//   2. client PUTs the file directly to Supabase Storage
//   3. {action:"confirm", revealId} -> verifies object exists, saves music_url
module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body || {};
  const revealId = typeof body.revealId === "string" ? body.revealId : "";
  const hostToken = typeof body.hostToken === "string" ? body.hostToken : "";
  const action = body.action;

  if (!/^[A-Za-z0-9_-]{6,24}$/.test(revealId)) {
    return res.status(400).json({ error: "Invalid reveal id" });
  }
  if (!hostToken) {
    return res.status(403).json({ error: "Host token required" });
  }

  try {
    const row = await sbSelect(
      `reveal_id=eq.${encodeURIComponent(revealId)}&sealed=eq.true`
    );
    if (!row) return res.status(404).json({ error: "Reveal not found" });

    // reveal_id is public — it's in the share link every viewer gets — so it
    // cannot be the only thing gating a write. Same host gate as reveal-state.
    if (!row.host_token || row.host_token !== hostToken) {
      return res.status(403).json({ error: "Only the commissioner can set the music" });
    }

    const objectPath = `fdl-music/${revealId}.mp3`;

    if (action === "sign") {
      const r = await fetch(
        `${SUPABASE_URL}/storage/v1/object/upload/sign/${objectPath}`,
        {
          method: "POST",
          headers: sbHeaders({ "x-upsert": "true" }),
          body: JSON.stringify({}),
        }
      );
      if (!r.ok) throw new Error(`Sign failed: ${r.status} ${await r.text()}`);
      const data = await r.json();
      return res.status(200).json({
        uploadUrl: `${SUPABASE_URL}/storage/v1${data.url}`,
      });
    }

    if (action === "confirm") {
      const head = await fetch(
        `${SUPABASE_URL}/storage/v1/object/public/${objectPath}`,
        { method: "HEAD" }
      );
      if (!head.ok) {
        return res.status(400).json({ error: "Upload not found" });
      }
      const musicUrl = `${SUPABASE_URL}/storage/v1/object/public/${objectPath}`;
      await sbUpdate(`reveal_id=eq.${encodeURIComponent(revealId)}`, {
        music_url: musicUrl,
      });
      return res.status(200).json({ musicUrl });
    }

    return res.status(400).json({ error: "Unknown action" });
  } catch (err) {
    console.error("Upload-music error:", err);
    return res.status(500).json({ error: "Music upload failed" });
  }
};

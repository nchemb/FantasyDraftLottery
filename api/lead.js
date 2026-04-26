module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body || {};
  const email = typeof body.email === "string" ? body.email.trim() : "";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Valid email required" });
  }

  const audienceId = process.env.RESEND_AUDIENCE_FDL;
  const apiKey = process.env.RESEND_API_KEY;

  if (!audienceId || !apiKey) {
    console.error("Missing RESEND_AUDIENCE_FDL or RESEND_API_KEY");
    return res.status(500).json({ error: "Server misconfigured" });
  }

  try {
    const r = await fetch(
      `https://api.resend.com/audiences/${audienceId}/contacts`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, unsubscribed: false }),
      }
    );

    if (!r.ok && r.status !== 409) {
      const text = await r.text();
      console.error("Resend error:", r.status, text);
      return res.status(500).json({ error: "Subscription failed" });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: "Subscription failed" });
  }
};

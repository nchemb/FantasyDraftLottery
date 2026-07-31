// Gmail ignores dots, so a.b.c@gmail.com and abc@gmail.com are one inbox.
// Signup bots exploit that to look unique to a dedupe check, and the local part
// they generate alternates consonant-vowel almost perfectly because it's built
// from syllables. 19 of the first 534 signups here came in that way.
function looksGenerated(email) {
  const [local, domain] = email.toLowerCase().split("@");
  if (domain !== "gmail.com" && domain !== "googlemail.com") return false;
  if ((local.match(/\./g) || []).length < 3) return false;
  const s = local.replace(/[^a-z]/g, "");
  if (s.length < 6) return false;
  const vowel = (c) => "aeiou".includes(c);
  let alt = 0;
  for (let i = 0; i < s.length - 1; i++) if (vowel(s[i]) !== vowel(s[i + 1])) alt++;
  return alt / (s.length - 1) >= 0.85;
}

const ALLOWED_ORIGINS = [
  "https://www.fantasydraftlottery.com",
  "https://fantasydraftlottery.com",
];

module.exports = async function handler(req, res) {
  // Was "*", which let any site on the internet POST straight into the audience.
  const origin = req.headers.origin;
  res.setHeader(
    "Access-Control-Allow-Origin",
    ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  );
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

  // Hidden field. A person never sees it; a bot fills every input it finds.
  // Answer 200 so the bot has no signal that it was rejected.
  if (typeof body.company === "string" && body.company.trim() !== "") {
    return res.status(200).json({ success: true });
  }

  if (looksGenerated(email)) {
    console.log("Rejected generated signup:", email);
    return res.status(200).json({ success: true });
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

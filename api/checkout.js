const { sbInsert, sbUpdate, stripe, newRevealId, newHostToken, validateInput } = require("./_lib");

// Optional scheduled showtime: must parse, sit in the future, and land within 90 days.
function parseSchedule(raw) {
  if (!raw) return { scheduledAt: null };
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return { error: "That broadcast time didn't make sense" };
  const now = Date.now();
  if (t < now - 5 * 60 * 1000) return { error: "Broadcast time has to be in the future" };
  if (t > now + 90 * 24 * 60 * 60 * 1000) return { error: "Broadcast time has to be within 90 days" };
  return { scheduledAt: new Date(t).toISOString() };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const parsed = validateInput(req.body || {});
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const sched = parseSchedule(req.body && req.body.scheduledAt);
  if (sched.error) return res.status(400).json({ error: sched.error });

  const GAP_CHOICES = [0, 30, 60, 120, 300];
  const pickGap = Number((req.body && req.body.pickGapSeconds) || 0);
  if (!GAP_CHOICES.includes(pickGap)) {
    return res.status(400).json({ error: "Invalid pick pacing" });
  }

  const baseUrl = process.env.BASE_URL;
  if (!baseUrl || !process.env.STRIPE_SECRET_KEY || !process.env.SUPABASE_URL) {
    console.error("Missing env config for checkout");
    return res.status(500).json({ error: "Server misconfigured" });
  }

  try {
    const row = await sbInsert({
      reveal_id: newRevealId(),
      league_name: parsed.leagueName,
      teams: parsed.teams,
      weighted: parsed.weighted,
      host_token: newHostToken(),
      scheduled_at: sched.scheduledAt,
      pick_gap_seconds: pickGap,
    });

    const session = await stripe("checkout/sessions", {
      mode: "payment",
      client_reference_id: row.id,
      "metadata[reveal_uuid]": row.id,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": "900",
      "line_items[0][price_data][product_data][name]": "Draft Night '26 — Live Broadcast Draft Reveal",
      "line_items[0][price_data][product_data][description]": `Sealed draft order and live announcer broadcast for ${parsed.leagueName}`,
      success_url: `${baseUrl}/api/finalize?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/draft-night.html?canceled=1`,
    });

    await sbUpdate(`id=eq.${row.id}`, { stripe_session_id: session.id });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Checkout error:", err);
    return res.status(500).json({ error: "Could not start checkout" });
  }
};

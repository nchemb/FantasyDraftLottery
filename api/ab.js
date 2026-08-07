// Price test funnel beacon.
//
// Counting paid rows over checkout starts would only measure the Stripe page.
// It cannot see the visitor who read $19 and closed the tab, which is the whole
// effect being tested -- so the funnel starts at the pageview and records the
// click that follows it:
//
//   exposure -> cta_click -> checkout_start -> paid
//
// checkout_start and paid come off fdl_reveals; the two front-end steps land
// here. Rows are unique per (visitor_id, event), so a repeat click collapses
// into the first and every step counts people rather than clicks.
const { SUPABASE_URL, sbHeaders } = require("./_lib");

const ALLOWED_ORIGINS = [
  "https://www.fantasydraftlottery.com",
  "https://fantasydraftlottery.com",
];

const EVENTS = ["exposure", "cta_click"];

module.exports = async function handler(req, res) {
  const origin = req.headers.origin;
  res.setHeader(
    "Access-Control-Allow-Origin",
    ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  );
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = req.body || {};
  const variant = body.variant === "a" || body.variant === "b" ? body.variant : null;
  const event = EVENTS.includes(body.event) ? body.event : null;
  const visitorId =
    typeof body.visitorId === "string" && /^[a-f0-9]{16,32}$/.test(body.visitorId)
      ? body.visitorId
      : null;

  if (!variant || !event || !visitorId) {
    return res.status(400).json({ error: "Bad event" });
  }

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/fdl_ab_events`, {
      method: "POST",
      // The unique index is the dedupe. A visitor who clicks the CTA three
      // times, or reloads, sends three beacons and still counts once.
      headers: sbHeaders({ Prefer: "resolution=ignore-duplicates" }),
      body: JSON.stringify({
        visitor_id: visitorId,
        variant,
        event,
        path: typeof body.path === "string" ? body.path.slice(0, 120) : null,
      }),
    });
    if (!r.ok) console.error("Event insert failed:", r.status, await r.text());
  } catch (err) {
    // A dropped event loses one data point. It must never break the page.
    console.error("Event error:", err);
  }

  return res.status(204).end();
};

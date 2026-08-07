#!/usr/bin/env node
/**
 * Price test readout: $9 (arm a) vs $19 (arm b).
 *
 *   node tools/ab-report.js            # since the test opened
 *   node tools/ab-report.js --days 3   # last 3 days only
 *
 * Reads the funnel, not just the sales:
 *
 *   exposure -> cta_click -> checkout_start -> paid
 *
 * cta_click is the one to watch early. It runs several times the volume of
 * paid, so it moves days before the sales numbers say anything, and it sits
 * exactly where a price does its damage: read the number, never clicked.
 *
 * The headline is revenue per exposure, NOT conversion rate. At this site's
 * volume a conversion-rate difference will never reach significance -- that
 * needs roughly 1,000 exposures per arm. What is readable is which arm made
 * more money per visitor, and the arithmetic that settles it is the breakeven:
 * $19 only has to hold 47% of the $9 conversion rate to win.
 *
 * Exposures include bots. They split 50/50 across arms, so they inflate both
 * denominators without biasing the comparison between them.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const { SUPABASE_URL, sbHeaders } = require(ROOT + "/api/_lib");

// Nothing before this carried a variant, and everything before it was $9.
const TEST_OPENED = "2026-08-07T00:00:00Z";

const PRICES = { a: 900, b: 1900 };

async function sb(table, query) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: sbHeaders() });
  if (!r.ok) throw new Error(`${table} query failed: ${r.status} ${await r.text()}`);
  return r.json();
}

const money = (cents) => "$" + (cents / 100).toFixed(2);
const pct = (n) => (n * 100).toFixed(2) + "%";
const rate = (num, den) => (den ? pct(num / den) : "—");

async function main() {
  const daysArg = process.argv.indexOf("--days");
  const since =
    daysArg !== -1 && process.argv[daysArg + 1]
      ? new Date(Date.now() - Number(process.argv[daysArg + 1]) * 86400000).toISOString()
      : TEST_OPENED;

  const [events, reveals] = await Promise.all([
    sb("fdl_ab_events", `select=variant,event&created_at=gte.${since}&limit=100000`),
    sb(
      "fdl_reveals",
      `select=price_variant,amount_cents,sealed&created_at=gte.${since}&limit=100000`
    ),
  ]);

  const arms = { a: null, b: null };
  for (const v of Object.keys(arms)) {
    arms[v] = { exposure: 0, cta_click: 0, starts: 0, paid: 0, revenue: 0 };
  }

  for (const e of events) {
    const arm = arms[e.variant];
    if (arm && arm[e.event] !== undefined) arm[e.event]++;
  }
  for (const r of reveals) {
    const arm = arms[r.price_variant];
    if (!arm) continue;
    arm.starts++;
    if (r.sealed) {
      arm.paid++;
      arm.revenue += r.amount_cents || PRICES[r.price_variant];
    }
  }

  console.log(`\nPrice test since ${since}\n`);

  console.table(
    ["a", "b"].map((v) => {
      const x = arms[v];
      return {
        arm: `${v} (${money(PRICES[v])})`,
        saw_price: x.exposure,
        clicked: x.cta_click,
        "click%": rate(x.cta_click, x.exposure),
        started: x.starts,
        paid: x.paid,
        "buy%": rate(x.paid, x.exposure),
        revenue: money(x.revenue),
        "rev/visitor": x.exposure ? money(Math.round(x.revenue / x.exposure)) : "—",
      };
    })
  );

  const A = arms.a;
  const B = arms.b;

  if (!A.exposure || !B.exposure) {
    console.log("Not enough exposures in both arms yet.\n");
    return;
  }

  const rpeA = A.revenue / A.exposure;
  const rpeB = B.revenue / B.exposure;
  const lift = rpeA ? (rpeB - rpeA) / rpeA : 0;
  console.log(
    `Revenue per visitor: $19 arm is ${lift >= 0 ? "+" : ""}${pct(lift)} vs the $9 arm.`
  );

  // What matters is not whether conversion dropped -- it will -- but whether it
  // dropped past the point where the higher price stops paying for itself.
  const breakeven = PRICES.a / PRICES.b;
  if (A.paid && A.exposure) {
    const held = B.paid / B.exposure / (A.paid / A.exposure);
    console.log(
      `$19 is holding ${pct(held)} of the $9 buy rate. Breakeven is ${pct(breakeven)}. ` +
        `-> ${held >= breakeven ? "$19 is winning" : "$19 is losing"}`
    );
  }

  // Clicks land days before sales do, so this is the early read.
  if (A.exposure && B.exposure && A.cta_click) {
    const heldClicks = B.cta_click / B.exposure / (A.cta_click / A.exposure);
    console.log(
      `Early signal -- $19 is holding ${pct(heldClicks)} of the $9 click-through rate.`
    );
  }

  const thinnest = Math.min(A.paid, B.paid);
  console.log(
    thinnest < 20
      ? `\nDirectional only -- thinnest arm has ${thinnest} sales. Keep running.\n`
      : "\nBoth arms past 20 sales. Safe to call it.\n"
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

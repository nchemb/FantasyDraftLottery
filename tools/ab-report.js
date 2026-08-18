#!/usr/bin/env node
/**
 * Price test readout. Arm 'a' is the incumbent price, arm 'b' the challenger.
 *
 *   node tools/ab-report.js            # the phase currently running
 *   node tools/ab-report.js --phase 1  # a finished phase
 *   node tools/ab-report.js --days 3   # last 3 days within the phase
 *
 * Phase 1 ($9 vs $19) is closed: $19 took 1 buyer of 485 against 6 of 489, a
 * 76% drop in revenue per visitor, while being clicked MORE. Interest was fine;
 * the number stopped people at the buy button. Phase 2 retests at $15.
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
 * the challenger only has to hold (incumbent / challenger) of the buy rate.
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

const { SUPABASE_URL, sbHeaders, PRICES, PRICE_PHASE } = require(ROOT + "/api/_lib");

// Phases, not timestamps. The window used to be a hand-edited date and it was
// wrong on day one: it swept in a day of pre-test $9 sales and reported them as
// arm 'a' beating a control that wasn't running yet. Rows now carry the phase
// that produced them, so the boundary can't drift out of sync with the price.
// `--phase 1` reads the finished $9-vs-$19 run.
const PHASE = (() => {
  const i = process.argv.indexOf("--phase");
  return i !== -1 && process.argv[i + 1] ? Number(process.argv[i + 1]) : PRICE_PHASE;
})();

// What each phase was testing, so a finished run still labels its own prices.
const PHASE_PRICES = { 1: { a: 900, b: 1900 }, 2: { a: 900, b: 1500 }, 3: PRICES };
const P = PHASE_PRICES[PHASE] || PRICES;

async function sb(table, query) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: sbHeaders() });
  if (!r.ok) throw new Error(`${table} query failed: ${r.status} ${await r.text()}`);
  return r.json();
}

const money = (cents) => "$" + (cents / 100).toFixed(2);
const pct = (n) => (n * 100).toFixed(2) + "%";
const rate = (num, den) => (den ? pct(num / den) : "—");

async function main() {
  // --days narrows within the phase; it never reaches across one, because two
  // prices in one average is not a number that means anything.
  const daysArg = process.argv.indexOf("--days");
  const sinceFilter =
    daysArg !== -1 && process.argv[daysArg + 1]
      ? `&created_at=gte.${new Date(
          Date.now() - Number(process.argv[daysArg + 1]) * 86400000
        ).toISOString()}`
      : "";

  const [events, reveals] = await Promise.all([
    sb("fdl_ab_events", `select=variant,event&phase=eq.${PHASE}${sinceFilter}&limit=100000`),
    sb(
      "fdl_reveals",
      `select=price_variant,amount_cents,sealed,visitor_id&price_phase=eq.${PHASE}${sinceFilter}&limit=100000`
    ),
  ]);

  const arms = { a: null, b: null };
  for (const v of Object.keys(arms)) {
    arms[v] = { exposure: 0, cta_click: 0, starts: 0, paid: 0, revenue: 0, buyers: new Set() };
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
      arm.revenue += r.amount_cents || P[r.price_variant];
      // One commissioner can run several leagues, and one did -- two purchases
      // minutes apart. Revenue counts both; a conversion RATE must not, or a
      // single enthusiastic buyer reads as two people persuaded by the price.
      if (r.visitor_id) arm.buyers.add(r.visitor_id);
    }
  }

  console.log(`\nPrice test — phase ${PHASE}: ${money(P.a)} vs ${money(P.b)}\n`);

  console.table(
    ["a", "b"].map((v) => {
      const x = arms[v];
      return {
        arm: `${v} (${money(P[v])})`,
        saw_price: x.exposure,
        clicked: x.cta_click,
        "click%": rate(x.cta_click, x.exposure),
        started: x.starts,
        sales: x.paid,
        buyers: x.buyers.size,
        "buy%": rate(x.buyers.size, x.exposure),
        revenue: money(x.revenue),
        "rev/visitor": x.exposure ? "$" + (x.revenue / x.exposure / 100).toFixed(3) : "—",
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
  const nameA = money(P.a);
  const nameB = money(P.b);
  console.log(
    `Revenue per visitor: ${nameB} arm is ${lift >= 0 ? "+" : ""}${pct(lift)} vs the ${nameA} arm.`
  );

  // What matters is not whether conversion dropped -- it will -- but whether it
  // dropped past the point where the higher price stops paying for itself.
  const breakeven = P.a / P.b;
  if (A.buyers.size && A.exposure) {
    const held = B.buyers.size / B.exposure / (A.buyers.size / A.exposure);
    console.log(
      `${nameB} is holding ${pct(held)} of the ${nameA} buy rate. ` +
        `Breakeven is ${pct(breakeven)}. ` +
        `-> ${held >= breakeven ? nameB + " is winning" : nameB + " is losing"}`
    );
  }

  // The honest headline while the sample is thin. A verdict that one more sale
  // would reverse is not a verdict, and "-31%" reads far more settled than it
  // is -- so print the number of sales that would flip it, every time.
  const perVisitorA = A.revenue / A.exposure;
  let flips = 0;
  while (flips < 50) {
    flips++;
    const swung = (B.revenue + flips * P.b) / B.exposure;
    if (swung > perVisitorA === !(rpeB > perVisitorA)) break;
  }
  console.log(
    rpeB > perVisitorA
      ? `Fragility: ${nameB} is ahead, but it is only ${B.paid} sale(s) of margin.`
      : `Fragility: ${flips} more sale(s) in the ${nameB} arm flips this to a win. ` +
          `At ${B.paid} vs ${A.paid} sales, that is a coin flip, not a finding.`
  );

  // Clicks land days before sales do, so this is the early read.
  if (A.exposure && B.exposure && A.cta_click) {
    const heldClicks = B.cta_click / B.exposure / (A.cta_click / A.exposure);
    console.log(
      `Early signal -- ${nameB} is holding ${pct(heldClicks)} of the ${nameA} click-through rate.`
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

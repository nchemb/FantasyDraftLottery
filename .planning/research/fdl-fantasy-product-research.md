# FDL — What to Build for 2026 Fantasy Season (research synthesis)

_Date: 2026-07-18. Four parallel research agents: paid-tool market, commissioner pain points, AI tool landscape, API/SEO feasibility._

## Assets in hand
- fantasydraftlottery.com — free draft order generator (random + weighted), ranks organically for "draft order generator", AdSense live, Vercel static site + one serverless fn
- **Resend list: 529 contacts, 1 unsub** (FantasyDraftLottery audience) — league commissioners, gmail/yahoo consumer emails
- Timing: drafts run ~Aug 15–Sep 5. ~4–6 week ship window. Site traffic + list attention peaks exactly then.

## TLDR
1. Advice tools (rankings, trade analyzers, start/sit) are saturated AND big platforms now ship AI advice free (ESPN watsonx, Yahoo Assistant GM, NFL+). Do not compete there.
2. Commissioner-side pain is underserved: #1 chasing dues, #2 LeagueSafe payout hell (1.7★ BBB), #3 weekly recap/engagement grind, #4 draft-order-reveal credibility/hype, #5 league history loss.
3. Sleeper API = free, no auth, full league/draft/roster/matchup data. FantasyPros rankings API ~$6/mo. Build feasibility for small tools = days.
4. AI recap generators exist (SmackScript free, Recap My League, League Legacy $36/yr) but all are manual/copy-paste. Gap = **agentic**: auto-runs all season, auto-posts to league channels.
5. fantasyleaguelottery.com already sells sealed draft-order reveals with 6 animation styles — validates paid demand directly adjacent to FDL's existing traffic.

## Market pricing reference (HIGH confidence)
- FantasyPros $48–108/yr, Draft Sharks $72–192/yr, Footballguys $60–200/yr, RotoViz $130/yr, ETR $55–300/season, 4for4 $39–799/yr, Dynasty Nerds $70/yr, RotoBot AI $119.99/yr
- League management mostly free (Sleeper/ESPN/Yahoo); League Legacy charges **$36/yr per league** for history + auto newsletters; FanStar $4/team
- Fantasy market $42B global, 57M US players, r/fantasyfootball 3.27M subs

## Commissioner pain (ranked, from Reddit/BBB/forums)
1. **Dues chasing** — 25–50% pay on time; commissioners nag for weeks [HIGH]
2. **LeagueSafe hell** — weeks-long payouts, invasive ID verification, no phone support, 4% CC fee [HIGH — BBB complaints]
3. **Weekly recap/newsletter grind** — highly valued, labor-intensive; AI tools emerging but manual [HIGH]
4. **Draft reveal credibility** — manual reveals get rigging accusations; reveal-as-event (videos, parties) is growing culture [HIGH]
5. **League history fragmentation** across platform switches [HIGH]

## AI landscape gaps (from landscape agent)
- Everything today = advisor (chat) or analyzer (one-off grade). Nothing **acts** season-long.
- Named gaps w/ HIGH confidence: agentic commissioner (auto recaps + dues + payouts + awards), league historian w/ multi-year memory, trade broker agent.
- SmackScript (free, screenshot upload, manual), FantasySmack, Recap My League (Sleeper-only), League Legacy — none auto-post, none autonomous.

## API table
| Source | Auth | Data | Notes |
|---|---|---|---|
| Sleeper | none | leagues, rosters, drafts, matchups, players, transactions | <1000 calls/min; THE indie choice |
| ESPN | none/cookies | league data | unofficial, breaks anytime — avoid |
| Yahoo | OAuth 2.0 | full fantasy data | official but heavy |
| FantasyPros | API key | rankings, projections, news | free personal; ~$6/mo prod |
| nflverse | none | raw NFL stats 1999– | stats, not projections |

## SEO
- "league recap generator" = white space (low competition). "draft order reveal" = low competition. "cheat sheet"/"name generator" = saturated.
- Seasonal SEO window for NEW pages this season basically closed (should publish by June). Distribution this season = existing rankings + 529-email list + in-league virality (every artifact seen by 10–12 members).

## Ranked build candidates
1. **Draft Order Reveal upgrade (premium on existing site)** — sealed/provably-fair lottery + animated reveal experiences + shareable reveal link/video + party mode. Direct competitor fantasyleaguelottery.com proves paid demand. Users already on FDL to do exactly this. Effort ~1 weekend. Price $5–10/league one-time or freemium. Zero distribution problem.
2. **AI League Recap Agent (season pass)** — commissioner connects Sleeper league ID (no auth) → every Tuesday agent pulls matchups, writes recap in chosen voice, auto-emails league + posts to Discord/GroupMe webhook. Weekly awards, power rankings, callbacks. $19–29/season per league. Effort ~2 weekends. Gap = autonomy + auto-post (nobody does it). Viral: footer in every recap seen by all members.
3. **Dues tracker + nag agent** — no money custody (tracker + Venmo links + automated reminders). Fintech-depth play but thin without custody; real LeagueSafe alternative = months + compliance. Park as v2 feature of #2's commissioner hub.
4. Avoid: rankings/advice/trade tools (saturated + free-from-platforms), cheat sheets, name generators.

## Didn't check (aggregated)
- Exact keyword volumes (no Ahrefs/SEMrush), subscriber/revenue counts for indie tools, ProductHunt traction data, r/FFCommish granular threads (Reddit blocked site: operator), Fantasy Footballers UDK pricing, fantasyleaguelottery.com pricing/traffic, conversion/churn benchmarks, Yahoo Fantasy Plus + NFL+ Premium prices, mobile-app-native commissioner tools.

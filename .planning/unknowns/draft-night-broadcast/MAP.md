# Draft Night Broadcast — Quadrant Map

_Walked 2026-07-18 with Neej. Product: $9 premium add-on to fantasydraftlottery.com._

## Q1 — Known knowns (settled ground)

- Site: static HTML/jQuery on Vercel (Pro). Free flow (form → client shuffle → `draftResults.html`) stays 100% untouched. `main.js:49-70` form collection, `main.js:96` weightedShuffle.
- Rails BUILT AND VERIFIED this session (keep all):
  - `api/_lib.js` — Supabase REST helpers, crypto `generateOrder` (Fisher-Yates + lottery-ball weighted, statistically verified 98.7%≈99%), reveal ids, SHA-256 commitment.
  - `api/checkout.js` — validates {leagueName, teams[2-32], weighted}, inserts pending `fdl_reveals` row, creates $9 Stripe Checkout Session (metadata reveal_uuid), returns url.
  - `api/finalize.js` — verifies session paid, seals order idempotently (guarded `sealed=eq.false` update), 302 → reveal page.
  - `api/reveal.js` — sealed-only fetch. `api/upload-music.js` — exists; custom-music feature CUT from new design (delete or leave dormant).
  - Supabase (agentindex project `yirzhxdbtdurbemavjkv`): `fdl_reveals` table + RLS on/no policies; `fdl-music` bucket (dormant).
  - `index.html` premium gold button + explainer; `style.css` premium styles; `reveal.html/js/css` — page shell, board/chips/sequencing logic reusable; 3 CSS theme skins now DEAD.
  - Vercel prod env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BASE_URL set. `.env` local has same + STRIPE placeholder.
- Research: reveal-as-event validated (fantasyleaguelottery.com sells sealed reveals); commissioner list = 529 emails in Resend audience `3138379d-8637-49b3-8004-30980da24b69`.
- Higgsfield: 5,305 credits, Plus plan. Seedance 2.0 = template clip model (reference-driven consistency).
- ElevenLabs CLI installed (`/opt/homebrew/bin/elevenlabs`).

## Q2 — Known unknowns (decision ledger)

| Question | Answer | Closed by |
|---|---|---|
| Price | **$9** | user |
| Personalization depth | **B: template movie + TTS announcer speaks real team names.** No mascots, no per-sale video. | user |
| Always-on render worker? | **NONE.** Per-sale generation = TTS audio only, runs serverless at finalize. | user (challenged premise) + territory |
| Delivery | **Web player only.** No MP4 export in v1. | user |
| The experience | **NBA-draft broadcast:** commissioner avatar at podium announces bottom-to-top with real team names; called name populates its slot on the draft board; higher slots stay blank; builds to #1. | user (described verbatim) |
| Watch model | **Watch Party + replay.** Host link (secret token) starts/advances; viewers' pages sync via 2-3s polling; waiting room until start; replay after. | user |
| Scheduled mode (added 2026-07-29) | **Two start modes at purchase:** (A) manual — host token starts/advances; (B) scheduled — commish sets `scheduled_at`, waiting room shows countdown, server derives currentPick from elapsed clock time (`floor((now-scheduled_at)/per_pick_secs)`) — no cron/worker/host needed. Miss it live → replay. Supersedes early "no scheduled reveals" answer (changed after Neej mapped it to his own league: "tomorrow at 8pm... anyone can hop on the link and watch live"). | user |
| Purchase UX | Premium button → interstitial with **Loom demo video + $9 buy** → Stripe. Loom recorded from Neej's own league pilot. | user |
| Broadcast direction | **C: Retro Broadcast '96** — 4:3 letterbox, VHS grain, retro chyrons, wipes, ORIGINAL synth-brass score (soundalike, NOT Roundball Rock). | user |
| Done bar | **Pilot on Neej's own league draft → record Loom → launch email to 529 list.** Target: pilot ~2 wks, launch early Aug. | user |
| Pick-segment variety | OPEN (superseded by broadcast redesign — variety now = chyron/crowd cutaway rotation, decide in storyboard) | — |
| TTS voice choice | OPEN — pick classic play-by-play stock voice; test at build. Key: pull from ElevenLabs CLI config. | — |
| Stripe key | OPEN — need test + live key from Neej (existing sk_live in buildwithneej env; confirm same account OK for FDL). | — |

## Q3 — Unknown knowns (extracted taste/context)

- **Aesthetic = 90s NBC broadcast nostalgia.** Was visible all along: site already hosts "NBA On NBC Theme" + "NFL TNF Theme" wavs. Retro chyrons, grain, letterbox. Reshapes: graphics package, score, avatar wardrobe (boxy 90s suit), transition wipes.
- **The seriousness is the joke** — treating "Last Place Larry" with real draft-night gravitas. Voice = warm classic play-by-play, not hype-roast.
- **His league is the first customer.** Real deadline = his draft (Aug). Pilot doubles as the Loom marketing asset.
- **He kills complexity on sight** — challenged the worker, was right. Bias every remaining choice toward zero-infra.

## Q4 — Unknown unknowns (landmine cards)

1. **IP (sharp edge):** No Roundball Rock melody, no NBA/NFL marks, no Adam Silver likeness in the PAID product. Original soundalike score + generic commissioner + "Draft Night '96" package. Free page untouched. — mitigated by design
2. **iOS audio autoplay (decided):** viewers' synced pages can't play un-gestured audio → waiting room "JOIN THE BROADCAST" tap unlocks audio. Load-bearing UX.
3. **Sync (decided):** polling `api/reveal-state` every 2-3s; host token minted at purchase; share link has no host powers.
4. **TTS at finalize (decided):** parallel ElevenLabs calls (~3-5s for 32 lines); raise Vercel `maxDuration`; sanitize team names for VO (strip emoji/symbols); store MP3s in Supabase Storage (small files OK there); template VIDEO from Vercel CDN static (no egress bill).
5. **32-team length (decided):** >16 teams → quick-chyron pacing (~7s/pick) to keep runtime sane.
6. **Checkout copy (small fact to confirm in build):** rename product name/description from "Premium Sealed Reveal" to broadcast branding in `api/checkout.js` + index button copy.
7. **Cleanup owed:** test rows in `fdl_reveals` (`TESTdemo12`, pending `6NB44aorecae`) — purge before launch.

## Small facts builder must confirm before coding

- ElevenLabs API key location + plan limits (CLI config).
- Stripe account/keys for FDL ($9 product) — Neej to provide/confirm.
- Loom URL (exists only after pilot; interstitial ships with placeholder).
- Template clip list + timings — locked in storyboard gate (next step, $0 keyframes first).

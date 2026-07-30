# EXECUTE — Draft Night Broadcast ($9 premium, fantasydraftlottery.com)

Fresh-session implementation prompt. Read MAP.md first (same directory) — it holds every decision + why. Keep `implementation-notes.md` in this directory as you build: every deviation from this plan gets a line (what changed, why).

## Objective

Replace the CSS card-flip reveal layer with the **Retro Broadcast '96 draft-night experience**: a commissioner-avatar broadcast that announces the sealed order bottom-to-top with an ElevenLabs voice speaking real team names, a retro chyron draft board filling slot by slot, watched live by the whole league via Watch Party sync. Payment/sealing rails already exist and stay.

## Judgment calls (most likely to tweak — alternatives noted)

1. **Storyboard + template library (GATE: Neej approves before ANY Higgsfield spend).**
   Draft shot list (~4-6 clips, 4-8s each, Seedance 2.0, 16:9, style-locked via reference stills generated FIRST with $0 Codex imagegen — see gen-image skill):
   - arena exterior/interior retro flyover (cold open)
   - commissioner (generic, boxy 90s suit) at podium — idle/speaking wide shot (distance framing = no lip-sync needed)
   - crowd reaction cutaway ×2
   - confetti finale wide
   VHS grain/letterbox/chyron applied as CSS/canvas overlays in the PLAYER, not baked into clips (tweakable later). Alternative: bake grain into clips for consistency; costs re-generation to change.
   Original synth-brass score: generate with Higgsfield audio (soundalike vibe, NOT Roundball Rock melody). IP rules in MAP Q4.1 are hard constraints.
2. **Broadcast sequencing (player):** waiting room → cold open → per-pick loop [podium clip + VO line + chyron slides name into slot N + crowd cut] → drumroll final-two → #1 + confetti + full board + credits. >16 teams: quick-chyron pacing ~7s/pick. Reuse board/chip DOM patterns from existing reveal.js; delete the 3 theme skins.
3. **Watch Party — two start modes (commish picks at/after purchase):**
   - **Manual:** host link = reveal link + `host=<token>` (mint `host_token` column at checkout). Host presses START/advances (or auto-advance default with host pause). Host POSTs advances with token.
   - **Scheduled (added 2026-07-29):** commish sets `scheduled_at` (datetime, editable via host token until start). Waiting room shows live countdown. From `scheduled_at` onward the server DERIVES state from the clock — `currentPick = floor((now - scheduled_at) / perPickSecs)` — no cron, no worker, no host online. Pacing constant per team-count (quick mode >16 teams) so derivation is pure math.
   - Both: viewers poll `api/reveal-state.js` (GET returns {mode, started, currentPick, scheduledAt, updatedAt}) every 2-3s. Waiting room requires JOIN tap (unlocks iOS audio). Replay after end regardless of mode. Alternative if polling feels laggy: Supabase Realtime (needs RLS read policy) — do NOT build first.
4. **TTS at finalize:** after sealing, generate announcer lines in parallel via ElevenLabs API (key: from Neej's CLI config / ask). Line template: "With the {ordinal} pick in the {league} draft... the league selects: {team}." Sanitize names (strip emoji/symbols) for VO only. Store MP3s in Supabase Storage bucket `fdl-audio` (create; public). Raise finalize `maxDuration` (vercel.json functions config). Failure fallback: reveal plays with chyron-only (no VO) + row flagged for regen.

## Mechanical (trust the executor)

- `api/checkout.js`: add `host_token` (crypto random) to row; success redirect → sealed confirmation state showing HOST link + share link separately; rename Stripe product copy to "Draft Night Broadcast — Sealed Draft Reveal".
- Migration (Supabase MCP, agentindex `yirzhxdbtdurbemavjkv`): `alter table fdl_reveals add column host_token text, add column broadcast_state jsonb default '{"started":false,"currentPick":null}', add column audio_manifest jsonb, add column scheduled_at timestamptz;` + `fdl-audio` bucket.
- `api/reveal.js`: include audio manifest URLs; never expose host_token on the share-link path.
- Purchase interstitial on index.html: modal w/ Loom embed placeholder + $9 buy button (replaces direct-to-checkout).
- Purge test rows (`TESTdemo12`, `6NB44aorecae`) before launch.
- Env needed: ELEVENLABS_API_KEY, STRIPE_SECRET_KEY (test→live, from Neej), existing SUPABASE_*/BASE_URL already in Vercel prod.
- Verify per UI rules: vercel dev preview link to Neej, ask before push, kill server after.

## Acceptance criteria (machine-checkable)

1. Free flow unchanged: form → Generate Order → draftResults.html identical to prod behavior.
2. `node --check` passes on all api/*.js; no new deps/package.json (raw fetch pattern).
3. Seeded sealed row plays full broadcast in browser: waiting room → picks announce bottom-to-top with audible VO naming teams → board fills correct slots → confetti on #1 → replay works on reload.
4. Watch Party manual mode: two browser windows — host starts, viewer window (no token) advances within 3s of host; viewer window cannot advance state via API (403 without token).
4b. Scheduled mode: set `scheduled_at` 1 min ahead → countdown shows in waiting room → broadcast auto-starts at time in BOTH windows with no host action → picks advance on pacing clock → replay works after end.
5. Stripe test-mode purchase (4242 card) end-to-end: checkout → finalize seals once (double-visit = same order) → TTS files exist in storage → broadcast plays.
6. No NBA/NFL marks, no Roundball Rock melody, no real-person likeness anywhere in paid assets.
7. Lighthouse-level sanity on mobile viewport: board readable, JOIN tap unlocks audio on iOS Safari (manual check).

## Out of scope (v1)

- MP4 export/download; custom music upload (api/upload-music.js dormant); mascot generation; Supabase Realtime; scheduled reveals; multi-sport variants; refund automation.

## Kickoff

`Read .planning/unknowns/draft-night-broadcast/MAP.md and EXECUTE.md, then implement. Keep implementation-notes.md.`
First action: write the shot-by-shot storyboard + generate $0 keyframe stills → STOP for Neej's approval before any Higgsfield credit spend.

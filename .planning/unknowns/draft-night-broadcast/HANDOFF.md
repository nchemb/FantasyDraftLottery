# HANDOFF — Draft Night '26, finish to production-ready (2026-07-30)

Fresh-session goal prompt. Neej reviews in the morning and HE pushes to prod — this session finishes everything up to that point but NEVER pushes, deploys, or runs `vercel --prod`.

## Product in one paragraph

$9 add-on to fantasydraftlottery.com. Commissioner enters teams on the home page, hits the gold Draft Night button, picks a broadcast time (or manual start) + pacing, pays via Stripe. Order is generated server-side once at payment and sealed (nobody can peek or re-roll, including the commissioner — that gate is the product promise). League gets one share URL; at showtime every open page plays the same retro-'90s NBA-style broadcast in sync: announcer VO calls picks bottom-up, names slam onto a draft board, confetti on #1, replay after. Sync = pure clock math off a shared showStart timestamp; zero workers.

## Read first

- `.planning/unknowns/draft-night-broadcast/MAP.md` — every decision + why
- `.planning/unknowns/draft-night-broadcast/implementation-notes.md` — build log, gotchas, deviations
- This file's Remaining Work section = the actual todo list

## State: DONE and verified

- 12 template clips in `broadcast/` (arena, stage, 4 podium variants, 5 crowd variants, confetti) — h264, silent, faststart-remuxed. Seedance 2.0 from approved '26 keyframes.
- Demo broadcast at `reveal.html?demo=1` (6-team "Gridiron Gang", static VO in `broadcast/demo/`).
- Player (`reveal.html/js/css v=3`): waiting room (countdown or host START + JOIN tap for iOS audio), deterministic timeline, seeded clip variety (multipliers must stay coprime with pool sizes), seeded ken-burns camera moves, pacing gaps (0/30/60/120/300s) with countdown chyron + atmosphere rotation, 2-col board >16 teams, quick pacing >16, replay (always gap 0), end screen.
- APIs (`api/*.js`, CommonJS raw-fetch, NO package.json): checkout (host_token, scheduled_at, pick_gap_seconds, product copy), finalize (guarded idempotent seal + parallel ElevenLabs TTS → fdl-audio bucket → audio_manifest; graceful chyron-only fallback; maxDuration 60 in vercel.json), reveal (order+audio GATED until showtime), reveal-state (GET state; host POST start/schedule/pacing, 403 otherwise). All `node --check` clean.
- Supabase (agentindex `yirzhxdbtdurbemavjkv`): fdl_reveals has host_token, broadcast_state, audio_manifest, scheduled_at, pick_gap_seconds; `fdl-audio` public bucket exists.
- Landing `draft-night.html` (humanized copy, hero video, demo link, schedule + pacing pickers, buy box reads localStorage `fdl_dn_league` written by home-page button). Home page gold flashing button aligned desktop+mobile (`style.css?version=23`).
- Verified: sealed-order gating pre/post showtime, 403s, idempotent seal, free flow untouched, scheduled auto-start (API level), demo runs error-free.
- Stripe CLI paired to **AlphaFlow LLC** (`acct_1T2w28GWbPMToeww`); fresh test key (expires 2026-10-28) already in `.env` + `.env.local` ([default] profile in `~/.config/stripe/config.toml`). CONFIRM with Neej this is the right account for FDL before live keys.

## STATUS 2026-07-30 03:50 — all six items below are DONE

Everything in "Remaining work" is complete and committed locally (`77b91da`, not pushed).
See `implementation-notes.md` → "Round 3" for what changed and why. What's left is only the
launch steps that need Neej: swap the live Stripe key, eyeball the video layer in a real
browser, push, self-buy + refund, then the Loom + Resend send.

Two things a future session must not re-derive:
- The ElevenLabs key was on the machine all along at `~/.elevenlabs/api_key` (Creator tier).
- Video playback has never been visually confirmed across three sessions because this Mac's
  Chrome decoder is wedged for *all* mp4s (an MDN reference clip also stalls at readyState 0).
  Do not spend time on it in automation — it needs Neej's own browser.

## Remaining work (in order) — COMPLETED, kept for the record

1. **Voice upgrade — Neej's top note: current VO too flat, wants a real dramatic draft-night announcer.**
   - Current demo voice: Higgsfield text2speech_v2 elevenlabs engine, preset "Brooks", dramatic text formatting (caps + ellipses — template already in `api/finalize.js` voScript).
   - Best path: get ELEVENLABS_API_KEY from Neej (elevenlabs.io → profile → API keys; CLI at /opt/homebrew/bin/elevenlabs but no key stored on machine). With direct API: browse voice library for a sports-announcer voice, tune voice_settings (style up, stability down), consider eleven_v3 audio tags like [excited]. Set ELEVENLABS_VOICE_ID env.
   - Fallback: iterate Higgsfield presets (samples for Brooks/Grant/Marcus in this dir as voice-sample-*-dramatic.mp3 — ask which he liked, if any).
   - Regenerate all 8 demo files in `broadcast/demo/` with the winning voice so the landing-page sample sells it.
2. **Bed music (NFL theme) — wired but UNVERIFIED audible.** `broadcast/bed-music.mp3` (converted from "NFL Network's Thursday Night Football Theme(Extended).wav" — the 45MB original never loaded, that was the silence bug). Player: BED_VOLUME 0.28, ducks to 0.08 under VO. Verify it actually plays in the demo, tune so it reads "lightly in the background" per Neej.
3. **Finish Stripe test-mode E2E.** In-flight test: row `Y0r2veIvTTEh` (E2E Test League, unsealed), session `cs_test_a1a1Pxe52gwL2RcE1R4LbxFXIwO3HAZNnymVfipgZXy76TSoqD2wnMEoH4`. Checkout Sessions create their payment_intent only after the payment page initializes — either fill the hosted page with test card 4242 4242 4242 4242 (any future exp/CVC/zip) or, once the PI exists, `stripe payment_intents confirm <pi> --payment-method pm_card_visa`. Then verify: finalize seals once (second visit = same order), host redirect lands with token + share link, TTS files in fdl-audio (needs key from step 1; without it confirm chyron-only fallback), broadcast plays, scheduled + manual modes both work two-window (viewer no-token cannot advance).
4. **Vercel prod envs (prep only, no deploy):** add STRIPE_SECRET_KEY (test key for now — Neej swaps live at push), ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID via `echo -n "VAL" | vercel env add NAME production` (echo -n — trailing-whitespace kills Vercel envs silently). SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BASE_URL already set.
5. **Cleanup before he pushes:** purge fdl_reveals test rows (`TESTdemo12`, `6NB44aorecae`, `TESTsched01`, `Y0r2veIvTTEh`, any other E2E leftovers). Confirm `.env`/`.env.local` gitignored (they are — verify again). `git status` review: stage new files (api/, broadcast/ ~35MB, reveal.*, draft-night.html, vercel.json, index.html, main.js, style.css, .planning docs) — commit locally, DO NOT push.
6. **Morning package for Neej:** dev-server preview links (home, draft-night, demo, a live sealed test broadcast), one-paragraph status, his push checklist (swap live Stripe key, `git push`, live $9 self-buy + refund via `mcp__stripe__create_refund`, then Loom + email to the 529-contact Resend list `3138379d-8637-49b3-8004-30980da24b69`).

## Gotchas (hard-won this session — do not relearn)

- `vercel dev` reads `.env` NOT `.env.local` for this static project. Restart it after env changes.
- New mp4s MUST be `-movflags +faststart` or Chrome shows black (moov at tail).
- Seedance: never quote literal signage text in video prompts (burned garbled captions); say "signage stays exactly as in reference image".
- Variant seeding: multiplier must be coprime with pool length or rotation collapses (the crowd-repeat bug).
- The automation Chrome's media decoding was wedged machine-wide (even MDN sample mp4 stalls at readyState 0) — verify visuals in Neej's own browser/Safari, don't burn hours on it.
- Higgsfield balance ~2,720 credits. Keyframe stills = $0 via Codex `$imagegen` (gen-image skill).
- Caveman mode active for replies. UI-change rules: preview link + ask before push + kill dev server after. Orca preference: preview files via `orca tab create --url` not Finder.
- Demo mode must keep working with NO api (static assets only) — it's the landing-page sales asset.

## Kickoff prompt (paste into new session)

```
Read .planning/unknowns/draft-night-broadcast/HANDOFF.md and follow its Remaining Work list end to end. Goal: Draft Night '26 fully finished and verified in test mode, staged for production — better announcer voice, NFL bed music audible but light, Stripe E2E purchase test green, prod envs prepped, test rows purged, local commit made. Do NOT push to prod or deploy — I review and push in the morning. Leave me preview links and a short status when done.
```

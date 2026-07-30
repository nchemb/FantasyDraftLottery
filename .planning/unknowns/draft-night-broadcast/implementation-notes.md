# Draft Night '26 — implementation notes (2026-07-29)

Deviations + decisions during build:

- **Year change:** all signage regenerated as "DRAFT NIGHT '26" (Neej call). '96 stills kept as `keyframes/*/out_v96.png`. First T3 test clip ('96 art) = 36 credits sunk, kept at `clips/T3-test.mp4`.
- **Manual mode collapsed into the clock model.** Host "start" just stamps `broadcast_state.startedAt`; from then on every client derives the show from elapsed time, same as scheduled mode. No per-pick host advance in v1 (storyboard's host-tap idea dropped for zero-drift sync + simpler API).
- **Spoiler gate:** `api/reveal.js` returns `draftOrder` + `audioManifest` ONLY once now >= showtime. Commissioner has no early access (product promise). Audio files get a random path prefix so URLs can't be guessed pre-show.
- **Bed music = NFL TNF wav looped in the player at 0.22 volume, ducked to 0.07 under VO.** Neej explicitly chose this over an original score; IP risk flagged and accepted. Swap = one constant in reveal.js.
- **Demo mode** (`reveal.html?demo=1`): 6-team "The Gridiron Gang", static VO in `broadcast/demo/*.mp3` (Higgsfield text2speech_v2, elevenlabs engine, voice "Sterling"). Serves as the landing-page example broadcast; replaces the Loom placeholder for now.
- **Prod VO:** finalize.js calls ElevenLabs REST directly (`ELEVENLABS_API_KEY` + optional `ELEVENLABS_VOICE_ID`, default Adam). Missing key or TTS failure → broadcast plays chyron-only; row keeps `audio_manifest = null` for later regen. `vercel.json` raises finalize maxDuration to 60s.
- **Clips remuxed with `-movflags +faststart`** (moov was trailing; Chrome progressive playback needs it up front). Silent (`-an`). Live in `broadcast/*.mp4`, served off Vercel CDN.
- **Voice samples for Neej:** `voice-sample-sterling.mp3` / `voice-sample-brooks.mp3` in this directory.
- **Verify note:** the automation Chrome's media pipeline was wedged machine-wide during testing (even MDN reference mp4 stalls at readyState 0), so video playback was NOT visually confirmed in-browser this session. Files verified h264/yuv420p/faststart; board, chyrons, pacing engine, waiting room, and all API gates verified. Neej to eyeball demo in his own browser.

## Verified this session
- `node --check` all api/*.js ✓
- Migration applied + columns confirmed (host_token, broadcast_state, audio_manifest, scheduled_at) + `fdl-audio` bucket ✓
- Pre-showtime: no draftOrder in API response ✓ · post-showtime: live:true + order ✓ (TESTsched01)
- reveal-state POST without/with wrong host token → 403 ✓
- Free flow untouched (index + draftResults 200, Generate Order intact) ✓
- Demo broadcast: waiting room → cold open → pick chyrons → board renders ✓ (video layer pending visual check)

## Blocked on Neej
1. `stripe login` (CLI test key expired 2026-04-24) → then E2E 4242 purchase test → live key before launch.
2. `ELEVENLABS_API_KEY` (no key found on machine; CLI installed but unconfigured) → prod announcer VO.
3. Approve: demo broadcast look/feel, voice (Sterling vs Brooks), landing copy.

## Pre-launch cleanup owed
- Purge test rows: `TESTdemo12`, `6NB44aorecae` (pending), `TESTsched01`.
- Swap BASE_URL env confirmation + STRIPE live key.
- Add STRIPE_SECRET_KEY + ELEVENLABS_API_KEY to Vercel prod envs.

## Round 2 (same day, Neej feedback on demo)
- **Variety:** 3 new crowd scenes (s7 toast, s8 fist-pump, s9 head-shake comedy) + 2 podium idle variants (tie-straighten, jumbotron-glance) → 5 crowd + 3 podium clips total. Player selects per pick via deterministic seed (pick number), never Math.random, so all viewers stay identical. Files: t7-crowd-c, t8-crowd-d, t9-crowd-e, t3-podium-b, t3-podium-c.
- **Pacing gaps:** `pick_gap_seconds` column (0/30/60/120/300, validated whitelist). Chosen on landing page, editable pre-start via host link (reveal-state action "pacing"). Gaps = chains of 10s "atmo" segments rotating existing clips with a ticking "PICK 7th COMING UP · 1:42" chyron. Replays always run gap 0.
- **Home button alignment fix:** normalized margins + line-height + vertical-align:middle on both buttons; ≤576px both go full-width stacked. Verified desktop screenshot + 390px iframe computed styles.
- **Chrome media caveat from round 1 persists** (decoder wedged machine-wide in test browser); new clips verified served (200) + faststart, not visually played.

## Round 3 (2026-07-30, finish-to-staged session)

**Announcer voice — replaced.** Found a working key at `~/.elevenlabs/api_key` (Creator tier,
363k chars) that round 2 missed; step 1 was never actually blocked. Auditioned 6 announcer
voices from the shared library against the real #1-overall line and scored them objectively
(pitch spread in semitones + EBU R128 loudness range + frame-level punch), since nobody could
listen. Winner: **Tyler — Energetic Arena Announcer** `GyIXYY876myKNtA1j8NI`, `eleven_v3`,
stability **0.5**. 0.5 beat 0.0 on drama for identical text on both A/B pairs *and* holds the
same announcer across calls, which matters because every pick is its own request.
Demo VO mean drama score **41.1 → 59.3 (+44%)**, punch +64%. All 8 demo clips regenerated and
transcript-verified. Audio tags (`[dramatic]`, `[shouting]`) are honoured, never spoken;
`sanitizeForVO` strips brackets so a team name can't inject one.

**Bed music — root-caused, not just tuned.** It was never audible because of a promise race,
not a volume problem: the JOIN handler primes media under the user gesture and pauses it in a
`.then()`, but `goLive()` runs synchronously right after, so the priming promise resolved *on
top of* live playback and paused the bed for the whole show. Same race froze the video
elements. Both now guarded by `playing`. Regression test: `test-bed-race.js` (needs
`npm i jsdom` in a temp dir) runs the real `reveal.js` and shows pre-fix pauses, current
doesn't. Duck floor raised 0.08 → 0.12: measured 0.08 sat 22.5 dB under the announcer
(inaudible); 0.12 sits ~19 dB under. Un-ducked 0.28 is ~12 dB under = "light".

**Timeline constants — VO was overrunning its slots.** VO is not truncated at a segment
boundary, it bleeds into the next one and the announcer talks over himself. Measured worst
case: intro 15.3s vs COLD_OPEN 14s, and a longest-ordinal + 50-char-team-name pick renders
**10.9s** vs PER_PICK_QUICK 8s. Now COLD_OPEN 17s, PER_PICK_QUICK 11s, TWO_REMAIN 7s.
`reveal.css/js` bumped to `?v=4` — mixed cached versions would desync viewers mid-show.

**finalize.js concurrency.** It fired every clip via `Promise.all`; a 32-team league is 34
calls and the account caps at 5 (6 in flight measured a 429), so a big league would have lost
its whole manifest to the chyron-only fallback. Now a bounded pool of 4 with backoff retry
on 429/5xx. 8 clips render in 10.5s; 34 projects to ~30s, inside the 60s budget.

**Two security fixes found while staging:**
- `api/upload-music.js` had **no auth at all** — it keyed writes on `reveal_id`, which is
  public (it's in the share link every viewer gets), so anyone with the link could get a
  signed upload URL and overwrite a league's music. Now requires `hostToken`, same gate as
  reveal-state. The endpoint is still unreferenced by any page.
- `.planning/` would have been **served publicly** once committed (`HANDOFF.md` returned 200
  with the full build log, account ids, revenue notes). Now excluded via `.vercelignore` plus
  a `vercel.json` redirect as a second layer (verified 307 → `/`).

**Also:** fixed "in the *The* Gridiron Gang draft" double article; demo VO now renders through
the real prod `voScript` via `tools/gen-demo-vo.js` so the sales sample can't drift from what
buyers get; `tools/render-audio-preview.js` renders the browser-only mix offline for level
measurement and listening.

**Verified E2E (test mode, real card flow):** purchase → seal → 8/8 TTS clips uploaded under
an unguessable prefix → commissioner redirect → share link omits host token → pre-showtime
returns no order/audio → host auth matrix (403 no token / 403 wrong token / 400 bad action /
200 valid) → **6 repeat finalize calls left the row byte-identical** → manual start goes live
→ 409 on re-start → scheduled clock gate flips exactly at showtime.

**Still unverified:** video playback. The automation Chrome's decoder is wedged machine-wide
(an MDN reference mp4 also stalls at readyState 0), so this is the third session that could
not eyeball the video layer. Needs Neej's own browser.

## Credits ledger
5,305 (Jul 18) → 3,100 (Jul 29 start, ~2.2k spent elsewhere) → 2,903 now.
Session spend ≈ 197 credits: 36 ('96 test clip) + ~125 (6 final clips) + ~36 (10 TTS gens).

---
tags: [sessions]
project: FantasyDraftLottery
updated: 2026-07-31
---

## 2026-07-31 14:10 — Draft Night '26 shipped to production, first paid sale

**Outcome:** $9 paid add-on live at fantasydraftlottery.com. First real purchase completed ("Hall of Fame", 10 teams, sealed + 10 announcer clips). Launch email sent to 513 contacts.

**Decisions:**
- Announcer: ElevenLabs "Tyler - Energetic Arena Announcer" on eleven_v3, stability 0.5. Chosen over 5 others by measured pitch spread + loudness range, not by ear. 0.5 beat 0.0 on drama AND stays consistent across calls (each pick is its own request).
- Timeline fits the audio instead of guessing: mp3_44100_128 is CBR so bytes/16000 = duration. finalize stores per-clip ms in audio_manifest.dur; player sizes each segment max(base, dur+tail). Sync preserved because every client reads the same numbers.
- Pinned checkout to USD (adaptive_pricing disabled). Stripe was offering rupees to US buyers.
- Rapid-fire pacing for the first real league broadcast: the gap/atmo path had never been watched live.
- Sent to all 513 rather than warming up in batches (Neej's call, tradeoff flagged twice).

**Key Learnings:**
- iOS treats HTMLMediaElement.volume as READ-ONLY and ignores writes silently. Every iOS browser is WebKit, so Chrome on iPhone hits it too. Explains opposite symptoms on desktop vs mobile from one bug. Fix: route through a WebAudio gain node.
- iOS only grants playback to an element that already played inside a user gesture. VO Audio objects were built at showtime, long after the JOIN tap, so the whole broadcast ran mute on phones. Fix: one persistent element unlocked with 50ms of inlined silence, src re-pointed per line.
- A "replay" that reruns a finished show must stop polling server state, or the poll overwrites the local clock and snaps the viewer back to the end screen.
- Gmail ignores dots, so bots insert them to look unique past a dedupe check. Generated local parts alternate consonant-vowel at ~1.00 where real names sit ~0.40.
- \w in JS regex is ASCII-only. sanitizeForVO was deleting accents ("Jose" for "Jose"), so the board showed one name and the announcer said another.

**Files Modified:**
- api/_lib.js (unicode sanitize, mp3DurationMs, mapWithConcurrency, eleven_v3)
- api/finalize.js (bounded TTS pool, durations in manifest, audio tags)
- api/lead.js (CORS lockdown, honeypot, generated-address rejection)
- api/checkout.js (adaptive_pricing disabled)
- reveal.js / reveal.html / reveal.css (v8: WebAudio ducking, voPlayer unlock, replay fix, audio-fitted timeline, sample CTA)
- index.html / main.js (league restore from localStorage, Start over, honeypot)
- draft-night.html (roster + odds confirmation, real runtime estimate)
- tools/comp-broadcast.js, tools/gen-demo-vo.js, tools/render-audio-preview.js

**Pending:**
- [ ] Replies to @fantasydraftlottery.com bounce (no MX). Add Workspace domain alias before supporting paying customers.
- [ ] Roll the Stripe sk_live key: it was pasted into a chat transcript.
- [ ] Watch bounce rate on the 513-contact send; domain had zero sending history.
- [ ] Pacing-gap (30/60/120/300s) broadcast path has never been watched live end to end.

---

# FantasyDraftLottery Sessions

Consolidated session log. Updated by /compress.

---

## 2026-04-26 14:05 — Loops → Resend email capture migration

**Outcome:** Migrated email capture from Loops (newsletter form endpoint) to Resend "fantasydraftlottery" audience via new Vercel serverless function. UI/UX unchanged. Committed (ab32fb2), push pending.

**Decisions:**
- Add Vercel serverless function (`api/lead.js`) — static site can't call Resend Contacts API from client without leaking server key
- Use raw fetch + CommonJS (no `package.json` needed; Vercel auto-detects `api/*.js` as Node 22 functions)
- Use FDL-specific Resend API key (`re_HXAYcAoT_...`) separate from buildwithneej key for project isolation

**Key Learnings:**
- Vercel auto-runs `api/*.js` as serverless functions on static sites with no build config
- Loops `userGroup=fantasydraftlottery` distinction now implicit in Resend audience ID (no longer queryable on contact)
- Form `action` attribute irrelevant when JS handler intercepts submit and uses explicit fetch URL — but updated for cleanliness anyway

**Files Modified:**
- CREATED: `api/lead.js` (Vercel serverless function, CORS headers, email validation, Resend audience POST)
- CREATED: `.gitignore` (added by `vercel link`, ignores `.vercel/`)
- MODIFIED: `index.html` lines ~140 (form action), ~317 (fetch URL + JSON body)
- MODIFIED: `draftResults.html` lines ~94 (form action), ~203 (fetch URL + JSON body)
- Vercel env: added RESEND_API_KEY + RESEND_AUDIENCE_FDL (production + development)

**Pending:**
- [ ] Push commit ab32fb2 to main
- [ ] Verify live signup on fantasydraftlottery.com after deploy
- [ ] Cleanup smoke test contact: `smoketest+fdl@fantasydraftlottery.com`

---

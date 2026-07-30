---
tags: [sessions]
project: FantasyDraftLottery
updated: 2026-04-26
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

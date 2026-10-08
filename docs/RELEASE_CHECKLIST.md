# Release checklist — from development to the conference

One page of gates. Work top to bottom. **Do not start a section until every box in the section above it is ticked.** Each gate names who signs it off. Record dates and evidence links next to each box.

Release model ([DEPLOYMENT.md](DEPLOYMENT.md)): `main` → automatic **Preview** (development Supabase). Production is built **only** from the `production` branch, which is moved deliberately. Merging to `main` never deploys Production.

State at the time of writing (8 October 2026): `main` = `e91d3d9`; development Supabase has every migration through `20261008135032` applied once; development acceptance passed; `production` = `c0a6a65`; **no Production deployment and no production Supabase project exist**; the Supabase upgrade and load rehearsal are deliberately deferred to conference week.

---

## 0. Now → conference week (development only)

- [ ] Staff familiarisation rehearsal run on development: [STAFF_REHEARSAL.md](STAFF_REHEARSAL.md) (no load). — Executive
- [ ] Runbook and emergency sheet reviewed by the Executive and printed drafts marked up. — Executive
- [ ] Only bug fixes merged to `main`; every merge has green CI and a checked `main` Preview. — Codex / Claude
- [ ] **Open item:** procedure for the very first Executive grant on a brand-new production project is written down and tried on development with a fresh conference. (The app cannot issue the first code itself: issuing codes requires an existing Executive grant.) — Codex, Claude to verify

## 1. Conference week (T-7 days) — capacity gate

Supabase plan and compute — technical lead:
- [ ] Upgrade the Supabase organisation to **Pro**.
- [ ] Move the project that will be rehearsed to **Small** compute (development first; production gets the same size).
- [ ] Billing owner confirmed; spend cap/alerts understood; region **ap-south-1 (Mumbai)**, same as Vercel functions `bom1`.

Rehearsal on the upgraded instance — Claude runs, Executive observes ([STAGING_REHEARSAL.md](STAGING_REHEARSAL.md)):
- [ ] Fresh synthetic fixture; realistic **multi-committee** run with **50 simulated staff** (role-scoped identities, ideally one Chair identity per real committee) plus the delegate QR burst.
- [ ] Offline / reconnect / recovery rehearsal (exact steps in STAGING_REHEARSAL.md), including one `PT409` "needs review" and one recovery export.
- [ ] Supabase *Logs* and *Observability* and Vercel *Logs* reviewed for the whole run window.

**PASS only if all are true** (attach the harness report and log screenshots):
- [ ] zero unexplained HTTP 5xx
- [ ] zero `PGRST003` (connection-pool) errors
- [ ] zero `40001` retry loops; zero statement timeouts
- [ ] zero lost and zero duplicate writes (harness exactly-once check and manual counts)
- [ ] read and write latency within the STAGING_REHEARSAL.md readiness criteria; real Chair browsers stay responsive

If anything fails: stop. Fix on `main`, re-verify the Preview, rerun the failed part. Do not create Production.

## 2. Production setup — only after section 1 passes

Supabase production project — technical lead with Codex:
- [ ] Create the production project (Pro, Small compute, ap-south-1). Database password stored in the password manager only.
- [ ] Apply every migration in `supabase/migrations/` **in order, exactly once** (`supabase db push` against the linked production project); record the ledger (`supabase migration list`) — it must equal the development ledger.
- [ ] Authentication → **Anonymous sign-ins enabled** (staff devices get their identity when an access code is entered). Email/password sign-ups not needed.
- [ ] Authentication → rate limits: anonymous sign-ins per IP set to the value measured in the shared-NAT test (default 30/hour is too low if more than ~25 staff devices are prepared from the school network in one hour).
- [ ] Storage: `resolutions` bucket exists (created by migration), private.
- [ ] Advisors run. Accepted findings only: SECURITY DEFINER access-code RPCs callable by signed-in users (by design: they check Executive access inside); "Anonymous Access Policies" warnings (by design: anonymous identities read only through grant-checked RLS); leaked-password protection (no passwords are used); unused indexes. **Anything else blocks.**
- [ ] Backups: daily backups present on Pro; restore steps read through once.
- [ ] Conference record created; first Executive granted using the procedure from section 0; that Executive issues the remaining codes from the app.

Vercel Production — Claude:
- [ ] Production environment variables set from [DEPLOYMENT.md](DEPLOYMENT.md#environment-variables) with **production** values; `SUPABASE_SECRET_KEY` marked Sensitive; `NEXT_PUBLIC_CONFERENCE_ID` = the production conference. No development value anywhere in Production.
- [ ] Deployment Protection changed so the **Production** domain opens without a Vercel login (Previews stay protected). Checked from a phone not signed in to Vercel.
- [ ] Conference domain added to Production (optional).

Release — technical lead, recorded in [RELEASES.md](RELEASES.md):
- [ ] Choose the `main` commit that passed section 1. Advance `production` to it **intentionally** (fast-forward; never force-push).
- [ ] Production build is READY; `npm run verify:deployment -- <production-url> <sha>` passes.
- [ ] System health on one device: `<version> · <sha7> · production`, Supabase `ok`, Storage `ok`, GREEN.
- [ ] One real QR submission (resolution) and one amendment from a phone on mobile data, no Vercel login prompt; then remove the test records in the app.
- [ ] Rollback drill once on Production with a harmless change (DEPLOYMENT.md → Rollback); time it (< 5 minutes).
- [ ] Declare the **known-good release**: tag, RELEASES.md entry, print the known-good card.

## 3. T-48 hours — freeze and people

- [ ] **Freeze:** no application changes. `CONFERENCE_FREEZE=1` set on Vercel Production; nobody advances `production` except an `[emergency]` fix (DEPLOYMENT.md → Production freeze). — technical lead
- [ ] Real conference data final: committees, rooms, delegates, schools, staff, Chairs & staff contacts, central session schedule, group photos. — Executive
- [ ] **Final real access codes generated** (one per Chair committee, Approval Panel, Admins, Executive), expiry set to the end of the conference, handed out privately. Test codes revoked. — Executive
- [ ] **Final QR sheets printed**: resolution submission sheet and amendment sheet for every committee, plus a saved PDF/photo of each. — Executive / Admins
- [ ] Staff devices prepared (RUNBOOK → *Staff device setup*) including spares; each shows the right role/committee and 0 unsynced. — Executive with Chairs
- [ ] Rollback release verified: the known-good deployment is the one in the Vercel list and the card matches System health. — technical lead
- [ ] Paper fallback ready and walked through once with every Chair (RUNBOOK → *Incidents*). — Executive
- [ ] Contact table in the runbook filled in; technical contact reachable for every session.

## After the conference

- [ ] Every device 0 unsynced and 0 needs review; recovery files reconciled then deleted.
- [ ] All access codes revoked (Executive → Access codes, with device revocation); browser data cleared on shared laptops only after the Executive confirms.
- [ ] `CONFERENCE_FREEZE` removed; final database export kept per the data-retention decision; Supabase compute/plan reduced if no longer needed.

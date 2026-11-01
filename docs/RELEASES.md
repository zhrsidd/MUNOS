# Release record

Record every production deployment that matters. The newest entry is first. See [DEPLOYMENT.md](DEPLOYMENT.md#known-good-conference-release).

## Known-good card (print this)

```
CONFERENCE OS — KNOWN-GOOD CONFERENCE RELEASE
Conference:          ______________________
Running version:     ____ · _______ · production     (as shown in System health)
Commit:              ________________________________________
Vercel deployment:   https://______________________.vercel.app
Deployment ID:       dpl_____________________
Database migration:  ______________ (latest applied)
Verified by / date:  ______________________ / ____________

If System health shows a different "Running version", tell the technical lead.
To return to this release: Vercel → Deployments → this deployment → Instant Rollback.
```

## Entries

| Date | Version · commit | Vercel deployment | Migration | Status | Verified by | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-11-01 | `cfa63dbd857e6fa639774b25448f25fc09621673` | `dpl_9qhVfe8nbCzKC2ZUBbpm8Nc7KvZ8` | 38 migrations through `20261101100000_amendment_link_committee_scope` (last prepromotion inventory) | Operator reports READY and healthy | Owner reports John Paul Ribeiru release approval and Zuhayr Siddique infrastructure/configuration approval | Supabase-backed Production; exact deployment, health and recovery details below. Known-good tag/card pending. |

## 1 November 2026 activation evidence

[Activation and remaining work](cutover/2026-11-01/EXECUTION.md#production-activation--1-november-2026) records the operator-reported deployment and health, conference creation, credential correction, public-phone access, approval and backup decision, plus GitHub-confirmed SHA, PR #101 and CI. The healthy retained deployment `dpl_9uNaCa71iAU3PJX4hhQxtUWtUQSD` is a same-revision recovery option, not an earlier-version rollback drill. No rollback was performed. Capacity monitoring and request-correlation limitations remain.

Known fields for the card: conference **DCMUN 2026**, commit `cfa63dbd857e6fa639774b25448f25fc09621673`, production URL `https://dcmun-os.vercel.app`, deployment `dpl_9qhVfe8nbCzKC2ZUBbpm8Nc7KvZ8`, and last prepromotion migration `20261101100000_amendment_link_committee_scope`. The application version, postpromotion migration-ledger verification and named card verifier remain unconfirmed. Do not print or declare a known-good card/tag until the operational checklist is complete.

# Protected database-backed deployment: requirements and options

Prepared 21 October 2026 on `origin/main` `276074a`. **This is a requirements and options document for owner decision. It authorises nothing.** No Vercel or Supabase call was made to write it, no environment variable, project, branch, domain or protection setting was changed, and no value of any secret appears in it. Production is untouched. It does not create another hosted database ([AGENTS.md](../AGENTS.md) protected area 1).

**Goal.** Functional testing of the real database-backed behaviour (sign-in with staff access codes, Chair and Approval flows, numbering, scoring, voting, offline sync, QR submission) can continue on a **protected** deployment of an exact commit, while the **public Production deployment stays in demo mode** and no real conference data exists. This is the "Development" phase of [INFRASTRUCTURE_LIFECYCLE.md](INFRASTRUCTURE_LIFECYCLE.md), which allows "protected connected Previews" on the one preproduction project.

## How every statement is labelled

| Label | Meaning |
| --- | --- |
| **Verified** | Read in the repository at `276074a`, or run in this preparation session. The evidence is named. |
| **Proposed** | A configuration or procedure written here and not executed anywhere. |
| **Untested** | Behaviour of Vercel or hosted Supabase that nobody has observed for this project. Confirm before relying on it. |

## 0. Starting state

| Fact | Status | Source |
| --- | --- | --- |
| One hosted Supabase project is the preproduction database now and, after promotion, production: `kllhswucdhqqywnzxado`. No second project may be created without owner approval. | **Verified** (documents) | [SUPABASE_PROJECT_SETUP.md](SUPABASE_PROJECT_SETUP.md), [AGENTS.md](../AGENTS.md) |
| Production serves a **demo-mode** build of `main` `542e705` with Supabase `not_configured`; Preview Supabase variables were removed by the owner. | **Verified** as recorded on 21 October (observed through Vercel and `/api/health`); **not re-observed here** | [V1_RELEASE_CHECKLIST.md](V1_RELEASE_CHECKLIST.md) items 1.3.2, 1.3.3 |
| Preview has been set to browser-demo mode (`NEXT_PUBLIC_DATA_BACKEND=local`) by owner selection on 20 October. | **Verified** (documents) | [DEPLOYMENT.md](DEPLOYMENT.md) "Environments" |
| The app is in demo mode unless `NEXT_PUBLIC_DATA_BACKEND` is exactly `supabase`; an unset variable is demo. | **Verified** (code) | `isCloud` in [`lib/repository-instance.ts`](../lib/repository-instance.ts), `expected` in [`lib/platform/health-probe.ts`](../lib/platform/health-probe.ts) |
| A Production build with `NEXT_PUBLIC_DATA_BACKEND=supabase` **fails** unless `NEXT_PUBLIC_SUPABASE_URL` is exactly `EXPECTED_SUPABASE_REF`; with the variable unset it fails closed. | **Verified** (code) | [`next.config.ts`](../next.config.ts), `checkProductionTarget` in [`lib/platform/target-guard.ts`](../lib/platform/target-guard.ts), `tests/target-guard.test.ts` (passed in this session) |

Because the database-backed deployment must **not** be Production and must **not** reuse a Production variable, it is a non-production Vercel deployment (`VERCEL_ENV` not `production`), and the existing non-production policy applies to it: the build, the health probe and the server routes refuse any Supabase project that is not listed in `STAGING_SUPABASE_REFS` or `DEVELOPMENT_SUPABASE_REFS` (never the production ref, never PHESMUN, nothing when no list is set). **Verified** (code, `targetProblem`; tests passed in this session).

## 1. Decisions the owner must make

| # | Decision | Recommendation here |
| --- | --- | --- |
| D1 | Reconnect any non-production deployment to the preproduction database at all. This reverses the owner-selected Preview demo mode of 20 October for that deployment. | Yes, for **one** protected deployment only (section 2). |
| D2 | Which deployment option (section 2). | Option B, a branch-scoped Preview on one dedicated branch. |
| D3 | Which allow-list variable holds the ref (section 3): `STAGING_SUPABASE_REFS` or `DEVELOPMENT_SUPABASE_REFS`. **Open owner decision.** | `STAGING_SUPABASE_REFS`. |
| D4 | Which test conference id is baked into the build (section 4). | A dedicated TEST conference, never one that will hold real data. |
| D5 | How testers pass Vercel's protection and how they get MUNOS staff access (section 6). | Named testers through Vercel sign-in, and synthetic short-lived MUNOS codes. |
| D6 | Whether the server-only `SUPABASE_SECRET_KEY` is set for this deployment (it enables QR submission and the health storage probe). | Set only if QR testing is in scope, as a Sensitive variable scoped to this deployment, and rotate it at cutover. |
| D7 | Approve the Vercel changes themselves. None are made by this document. | Required before any change. |

## 2. Vercel options (no Vercel change is made here)

All options give a deployment whose browser bundle is built with `NEXT_PUBLIC_DATA_BACKEND=supabase` and the project URL, publishable key and test conference id, all fixed at build time (section 4). They differ in **where the variables are scoped**, which decides what else is connected to the database.

| Option | What it is | For | Against | Status |
| --- | --- | --- | --- | --- |
| **A. All Preview deployments connected** | Set the variables for the whole Vercel **Preview** environment | Simplest; every PR gets a connected Preview | Every branch and PR build becomes database-connected and immutable; each must be found and **deleted at cutover** ([DEPLOYMENT.md](DEPLOYMENT.md) cutover step 3); reverses the owner's demo-mode choice for all Previews; any PR author's build can write synthetic data | **Not recommended** |
| **B. Branch-scoped Preview on one dedicated branch** (recommended) | Scope the variables to **one long-lived Git branch** (for example `preprod-test`); fast-forward that branch to the exact verified commit; Vercel builds a Preview of it | No plan change; all other Previews and Production stay demo; one stable branch URL plus one immutable URL per deploy; exact commit shown in `/api/health`; the existing guards apply because `VERCEL_ENV` is `preview`; the branch URL form is what [`scripts/rehearsal/guard.ts`](../scripts/rehearsal/guard.ts) accepts | Relies on Vercel's branch-specific Preview variables (documented Vercel behaviour, **Untested** for this project); the branch URL moves with every push, so record the immutable URL per candidate; every push to that branch makes a connected, immutable deployment to inventory and delete at cutover | **Proposed** |
| **C. Vercel custom environment** | A named environment (for example `preproduction`) with its own variables, tracking a branch | Own namespace; variables cannot leak to ordinary Previews | Plan-dependent (custom environments are not on every Vercel plan: **Untested**); what `VERCEL_ENV` reports for it is **Untested** (the guard treats every value other than `production` as non-production, so refusal behaviour is safe either way, but [`scripts/rehearsal/guard.ts`](../scripts/rehearsal/guard.ts) `checkHealthEnvironment` accepts only `preview`, `development` or `local-build`, so a slug there would be refused by the rehearsal tooling) | **Proposed** alternative |
| **D. Separate Vercel project** | A second project (for example `munos-staging`) | Instant Rollback exists only on a project's production deployments ([STAGING_REHEARSAL.md](STAGING_REHEARSAL.md)); isolates settings | If used through its **Production** environment it needs `EXPECTED_SUPABASE_REF` set to the ref, which registers the ref as the production role while the project is still preproduction, against lifecycle safeguard 3 (see section 10, conflict C4). If used through its **Preview** environment it has no Instant Rollback and is just option B in another project | **Not recommended** without an owner ruling |
| **E. Local build on an operator machine** | `npm run build` and `npm start` with the variables in an ignored environment | No Vercel change; used for the 21 October run; the surest exact-commit control | Testers cannot reach it; not a protected shared deployment | **Verified** as the 21 October method ([SUPABASE_PROJECT_SETUP.md](SUPABASE_PROJECT_SETUP.md)); keep for engineering checks |

**Exact commit under option B (Proposed).** Create or fast-forward the dedicated branch to the verified commit; never force-push shared history ([AGENTS.md](../AGENTS.md) working rules). The deployment's `app.commit` in `/api/health` must equal that commit (`npm run verify:deployment -- <url> <sha>`, section 7). Do not rebuild from a moving branch tip without re-recording the SHA. `vercel.json` already sets `ignoreCommand` to [`scripts/vercel-ignore-build.sh`](../scripts/vercel-ignore-build.sh), which only skips Production freeze builds, so a Preview of this branch always builds (**Verified**, read).

## 3. Target guard registration (open owner decision)

The guard keeps one role per project: the ref may be in `EXPECTED_SUPABASE_REF` (production), `STAGING_SUPABASE_REFS`, or `DEVELOPMENT_SUPABASE_REFS`, never two; `targetConfig` throws on a ref in two lists and on the PHESMUN ref anywhere. **Verified** (`tests/target-guard.test.ts`, passed in this session). The lifecycle says to use **one** nonproduction role only ([INFRASTRUCTURE_LIFECYCLE.md](INFRASTRUCTURE_LIFECYCLE.md) safeguard 3). Which one is **an open owner decision**.

| | `STAGING_SUPABASE_REFS` | `DEVELOPMENT_SUPABASE_REFS` |
| --- | --- | --- |
| Accepted by the build, the health probe, the QR backends | Yes (`checkToolTarget`) | Yes (same function) |
| Accepted by the operator tools (`smoke:project`, load, `remote-*`, rehearsal) | Yes | Yes |
| Accepted by the **hosted offline rehearsal** (`scripts/rehearsal/offline-hosted.mts`, `npm run test:rehearsal:offline` in hosted mode) | **Yes** | **No**: it requires the ref to be in `STAGING_SUPABASE_REFS` specifically ("development-only refs are refused") |
| Matches the repository's documents | [DEPLOYMENT.md](DEPLOYMENT.md), [SUPABASE_PROJECT_SETUP.md](SUPABASE_PROJECT_SETUP.md), [`.env.example`](../.env.example), [STAGING_REHEARSAL.md](STAGING_REHEARSAL.md), [OFFLINE_REHEARSAL_AUTOMATED.md](OFFLINE_REHEARSAL_AUTOMATED.md) and [V1_RELEASE_CHECKLIST.md](V1_RELEASE_CHECKLIST.md) all name `STAGING_SUPABASE_REFS` as the role while the project is in development | No repository document names it as the current role; scripts' comments still say "the DCMUN development project by default", which is stale |
| Cutover effect | Remove the ref from it everywhere and install `EXPECTED_SUPABASE_REF` in Production only | Same |
| Meaning of the name | "Staging" is, per the lifecycle, a preproduction validation phase, not a second project | Matches the lifecycle phase name "Development" |

**Recommendation: `STAGING_SUPABASE_REFS`.** It is the role every existing document and the one hosted rehearsal tool already use, so choosing it needs no documentation change and keeps the hosted offline rehearsal usable on the protected deployment. Choosing `DEVELOPMENT_SUPABASE_REFS` is workable for the deployment and the other tools but disables the hosted offline rehearsal on this ref and requires aligning the documents above. Whichever is chosen:

* Set the ref in **that one variable only**, in the Vercel scope of the deployment (section 5) and in the operator's shell, with the other variable empty or unset.
* `EXPECTED_SUPABASE_REF` must be **unset** in the scope of this deployment and in operator shells. Setting it makes `checkToolTarget` refuse the ref as production, and the build would refuse as well.
* The guard reads only the process environment of one deployment or shell ([ISOLATION_DESIGN.md](ISOLATION_DESIGN.md) F1), so it **cannot** detect the ref being listed as `EXPECTED_SUPABASE_REF` in the Production environment of Vercel and as an allow-list entry in Preview. That cross-environment check is a manual item in section 9 (see [V1_RELEASE_CHECKLIST.md](V1_RELEASE_CHECKLIST.md) item 1.3.8).
* The allow-list is read at **runtime** as well as at build time (the health probe and the QR backends call `targetProblem`), so the variable must be available to the running functions, not only the build. Vercel environment variables are available to both; **Untested** for a branch-scoped variable.

## 4. How the app is built in Supabase mode

**Verified** (code read).

* Variables prefixed `NEXT_PUBLIC_` are **inlined into the browser JavaScript at build time**. That includes the data backend, the project URL, the **publishable** key and the **conference id** ([`lib/repository-instance.ts`](../lib/repository-instance.ts) reads `NEXT_PUBLIC_CONFERENCE_ID` for every sign-in and sync). A deployment therefore serves exactly one conference, chosen when it was built. Changing a variable changes nothing for an existing deployment: it needs a **new build**.
* The server-only `SUPABASE_SECRET_KEY` is read at runtime by the QR submission routes (`/submit/*`, `/api/submissions`, `/amend/*`, `/api/amendments`) and the health storage probe ([`lib/submissions/backend.ts`](../lib/submissions/backend.ts), [`lib/amendments/backend.ts`](../lib/amendments/backend.ts), [`lib/platform/health-probe.ts`](../lib/platform/health-probe.ts)). It never reaches the browser. Without it the QR forms report "not available" and health reports `degraded`.
* The target guard runs in [`next.config.ts`](../next.config.ts) when the backend is `supabase`: the build **fails** for a forbidden project, for a Production build whose URL is not `EXPECTED_SUPABASE_REF`, and for any other Vercel build whose ref is not allow-listed or is the production ref. A successful build is itself evidence that the guard passed.
* Build identity (`NEXT_PUBLIC_BUILD_COMMIT`, `..._BRANCH`, `..._ENV`, `..._DEPLOYMENT_ID`) comes from Vercel's system variables, so leave "Automatically expose System Environment Variables" on ([DEPLOYMENT.md](DEPLOYMENT.md)).
* Build and install commands are `npm run build` and `npm ci` ([`vercel.json`](../vercel.json)); functions run in `bom1`.
* Each origin has its own IndexedDB outbox and service worker, so the protected deployment and the demo Production site do not share browser state. Use a `*.vercel.app` URL for the protected deployment, not the Production domain, so a device never mixes the two.
* **A preproduction build is never promoted.** Production must be rebuilt with Production-scoped variables from the verified commit; "do not reuse a preproduction build whose embedded target, keys or access boundary differs" ([INFRASTRUCTURE_LIFECYCLE.md](INFRASTRUCTURE_LIFECYCLE.md) formal cutover step 8).

## 5. Required environment variable names and scopes

Names only: **no values appear in this repository**. Set in the scope of the chosen option (option B: Vercel **Preview**, limited to the dedicated Git branch). Never "All Environments", which would include Production (section 9).

| Variable | Exposure | Needed | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_DATA_BACKEND` | Browser (inlined) | Yes | The literal value `supabase`. |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser (inlined) | Yes | `https://<ref>.supabase.co`; the project URL is in [SUPABASE_PROJECT_SETUP.md](SUPABASE_PROJECT_SETUP.md). Must be a hosted URL the guard accepts. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser (inlined) | Yes | Publishable key only (`sb_publishable_...`); never the secret or service-role key. |
| `NEXT_PUBLIC_CONFERENCE_ID` | Browser (inlined) | Yes | The TEST conference this deployment serves (decision D4). Also keep it in `PROTECTED_CONFERENCE_IDS` for load tools if desired ([`.env.example`](../.env.example)). |
| `NEXT_PUBLIC_CONFERENCE_TIMEZONE` | Browser (inlined) | Optional | Default `Asia/Qatar`. |
| `NEXT_PUBLIC_APP_VERSION` | Browser (inlined) | Optional | Defaults to the `package.json` version. |
| `STAGING_SUPABASE_REFS` (or `DEVELOPMENT_SUPABASE_REFS`, section 3) | Server and build; **not** `NEXT_PUBLIC_` | Yes | Contains the ref, in exactly one of the two variables. |
| `SUPABASE_SECRET_KEY` | **Server only**, mark **Sensitive** | Optional (decision D6) | Only for QR submission and the health storage probe; scope it to this deployment only, never Production. Never `NEXT_PUBLIC_`. Rotate it at cutover if it was ever set ([DEPLOYMENT.md](DEPLOYMENT.md) cutover step 5). |
| `EXPECTED_SUPABASE_REF` | Server and build | **Must be unset** here | Setting it in this scope registers the ref as production and the guard refuses the deployment. |
| `CONFERENCE_FREEZE` | Build | **Must be unset** here | Production freeze flag only. |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Operator shell only | Not a Vercel variable | Used by [`scripts/rehearsal-run.mts`](../scripts/rehearsal-run.mts) as the `x-vercel-protection-bypass` header. Never in the repository, never in a Vercel environment variable, never given to testers. |

Production keeps none of these Supabase variables (section 9). Vercel's "Development" target is not needed and should stay empty so that pulling a development environment never delivers database credentials.

## 6. Deployment protection and how testers authenticate

Two independent layers; neither replaces the other.

**Layer 1: who may open the deployment (Vercel).** [DEPLOYMENT.md](DEPLOYMENT.md) records Vercel Authentication on all deployments with a Protection Bypass for Automation held by the technical contact (**Verified** as documented 8 October; not re-observed). The connected deployment must keep protection **on**: it holds a working path to the database from the browser, and Vercel Authentication controls who can open a deployment, not what it can reach.

| Mechanism | Use | Status |
| --- | --- | --- |
| Vercel sign-in (team members) | Named testers who are on the Vercel team | **Proposed**; seat and plan implications **Untested** |
| Vercel shareable link for one deployment | A named tester without a team seat | **Proposed**; expiry and scope **Untested** |
| Password protection | One shared secret | Plan-dependent; **Untested** |
| Protection Bypass for Automation (header `x-vercel-protection-bypass`) | The operator's verification scripts only | **Verified** that `scripts/rehearsal-run.mts` sends it; **never** shared with testers: it opens every protected deployment of the project |

Delegates' phones at `/submit/*` and `/amend/*` also hit Vercel protection on a protected deployment: QR testing from a phone needs a shareable link or bypass-bearing URL for that device, or the check is done from a signed-in browser. This is the same constraint as checklist item 1.3.7 and 1.9.1 ([V1_RELEASE_CHECKLIST.md](V1_RELEASE_CHECKLIST.md)). **Untested.**

**Layer 2: who may use MUNOS (access codes).** Every staff workspace requires a staff access code and an active database grant, enforced in the database. **Verified** ([DEPLOYMENT.md](DEPLOYMENT.md), [SUPABASE_PROJECT_SETUP.md](SUPABASE_PROJECT_SETUP.md)).

* Testers use **synthetic codes for the TEST conference only**, minted by a test Executive in the app (Executive, Access codes) or by the hash-only credential insert shown in [NUMBERING_HOSTED_VERIFICATION.md](NUMBERING_HOSTED_VERIFICATION.md#81-create-the-conference-by-hash-only-credential-insert-proposed-the-credential-mechanism-is-verified-locally). Short validity (hours, not days).
* **Real staff sessions and real staff codes are never used on this deployment** ([INFRASTRUCTURE_LIFECYCLE.md](INFRASTRUCTURE_LIFECYCLE.md) safeguard 6). Testers use fresh browser profiles; a real staff member never signs in here.
* One active code exists per conference, role and committee (rotation retires the previous one), so testers of the same role share one code; devices already admitted keep working until their grants are revoked. To remove a tester, revoke the code **with** devices (`revokeAccessCode(..., revokeDevices)` in [`lib/access-codes.ts`](../lib/access-codes.ts)), or revoke the grants in SQL as in [NUMBERING_HOSTED_VERIFICATION.md](NUMBERING_HOSTED_VERIFICATION.md#85-revoke-only-cleanup).
* Codes are never pasted into chat, a ticket or a document.

**Residual risk (Verified, by design of the current system).** The browser calls the write RPCs directly with the publishable key and the user's session; a holder of that key and any valid session can write from any origin ([ISOLATION_DESIGN.md](ISOLATION_DESIGN.md) F3, [V1_RELEASE_CHECKLIST.md](V1_RELEASE_CHECKLIST.md) 1.4). While the project holds only synthetic data this is accepted by the lifecycle's Development phase; it is exactly why no real session may be used here, and why the deployment must be retired before real data exists.

## 7. Proving the deployment targets the right project

None of the following was run here. Use them in this order; stop at the first failure.

1. **Before the push (offline, nothing contacted). Verified.** The operator shell's guard accepts the intended URL and refuses the others, as in [NUMBERING_HOSTED_VERIFICATION.md](NUMBERING_HOSTED_VERIFICATION.md#2-target-checks-no-writes) T1.
2. **The build itself. Verified (code).** A successful Vercel build of a non-production deployment means the ref was in the allow-list, was not PHESMUN and was not `EXPECTED_SUPABASE_REF`. A wrong target fails with `Target guard: ... Refusing to build.` Record the build as evidence.
3. **Identity and health: `npm run verify:deployment -- <url> <sha>`. Verified to exist** ([`scripts/verify-deployment.mts`](../scripts/verify-deployment.mts)). It checks `/api/health` (status not `down`, `app.commit` starts with the SHA), the pages `/chair`, `/approval`, `/logistics`, `/admin/health`, `/projector` return 200, and an unknown submission link is rejected. **It sends no bypass header**, so on a protected deployment it receives Vercel's sign-in response and fails; run it from the app origin through a bypass-aware wrapper, a shareable link or a browser session, or extend it (gap G2). It does **not** prove which project the bundle points at.
4. **Health. Verified (code).** `/api/health` reports `app.environment` (expect `preview`), `app.commit`, `app.deploymentId`, and the three checks. It does **not** report the project ref (gap G1). `ok` therefore shows the deployment reached *a* project it is allowed to use, and a refused target shows `down` with detail `Wrong Supabase project` and contacts nothing; with one hosted project that is sufficient, with several it would not be.
5. **Bundle binding: the deployment's own JavaScript embeds the intended project and conference and no other. Verified for the logic, Untested for a real deployment.** `checkBundles` in [`scripts/rehearsal/delivery-audit.mjs`](../scripts/rehearsal/delivery-audit.mjs) requires the validated `NEXT_PUBLIC_SUPABASE_URL` and conference id in the bundles and **no other** `*.supabase.co` host; the hosted offline rehearsal runs it before any code is typed ([OFFLINE_REHEARSAL_AUTOMATED.md](OFFLINE_REHEARSAL_AUTOMATED.md), "Deployment binding"; self-tests in [`tests/rehearsal-delivery-audit.test.ts`](../tests/rehearsal-delivery-audit.test.ts) passed in this session). That document states the hosted binding path has only been exercised by self-tests and demo mode. There is no standalone, read-only command (gap G3). **Proposed manual equivalent:** fetch the `/chair` page and its `/_next/static/chunks/*.js` files with the bypass header from the operator shell, then confirm the expected `https://<ref>.supabase.co` and conference id occur and no other `https://<20 characters>.supabase.co` does.
6. **Functional proof of the data path. Proposed.** Sign in on the deployment with a synthetic Chair code: the workspace opens the TEST committee, **System health** shows `<version> · <sha7> · preview` and the Supabase mode ([`components/health.tsx`](../components/health.tsx)). Separately, from the operator shell, `npm run smoke:project` proves the project and codes through the app's own client code (it needs `SMOKE_EXECUTIVE_CODE`, never printed, and the allow-list); it does not go through the deployment.
7. **Full run. Proposed.** The hosted offline rehearsal (`npm run test:rehearsal:offline` with `REHEARSAL_MODE=hosted`, `REHEARSAL_BASE_URL`, `REHEARSAL_EXPECTED_ORIGIN`, `REHEARSAL_EXPECTED_COMMIT`) binds the deployment, denies every other origin and writes real rows to a temporary conference. It has **no Vercel bypass support** (only `scripts/rehearsal-run.mts` reads `VERCEL_AUTOMATION_BYPASS_SECRET`), so on a protected deployment it would stop at the Vercel sign-in page (gap G2). Prerequisites are in [OFFLINE_REHEARSAL_AUTOMATED.md](OFFLINE_REHEARSAL_AUTOMATED.md) (temporary conference, at least 5 delegates, a current session). Use it locally (option E) until protection support exists.

## 8. Health endpoint expectations

**Verified** (`probe` in [`lib/platform/health-probe.ts`](../lib/platform/health-probe.ts); [`app/api/health/route.ts`](../app/api/health/route.ts)). The route caches for 15 seconds and returns HTTP 503 only when the overall status is `down`.

| Deployment state | Overall | `checks` |
| --- | --- | --- |
| Demo mode (backend not `supabase`), including today's Production | `ok` | all `not_configured` |
| Supabase mode, target refused by the guard | `down` (503) | all three `down`, detail `Wrong Supabase project`; nothing contacted |
| Supabase mode, URL or publishable key missing | `degraded` | `not_configured` |
| Supabase mode, no `SUPABASE_SECRET_KEY` | `degraded` | `supabase` `ok` (Auth health), `database` and `storage` `not_configured`; QR forms report "not available" |
| Fully configured and reachable | `ok` | `supabase` `ok`, `database` `ok` (read-only `submission_link_info` call), `storage` `ok` (bucket `resolutions`) |
| Slow (over 2.5 s) | `degraded` | the slow check is `degraded` |
| Auth or database unreachable | `down` (503) | `down` |

Expected for the protected deployment once configured with the server key: `ok`, `app.environment` `preview`, `app.commit` equal to the recorded SHA. Without the key: `degraded` is expected, not a failure. The report carries no secret and no ref.

## 9. Public Production stays in demo mode

**Proposed checks, to be repeated after every Vercel change** (none was made here):

1. In Vercel, Production has **no** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_CONFERENCE_ID`, `SUPABASE_SECRET_KEY`, `EXPECTED_SUPABASE_REF` or either allow-list, and `NEXT_PUBLIC_DATA_BACKEND` is not `supabase`. Every variable added for option B shows only the Preview target and the one branch. **Untested** (dashboard).
2. The Production domain's `/api/health` still reports `status: ok`, `app.environment: production` and all three checks `not_configured`; its running version matches the recorded demo deployment. Compare with the 21 October observation in [V1_RELEASE_CHECKLIST.md](V1_RELEASE_CHECKLIST.md) item 1.3.2.
3. Production build safety is **fail-closed**: if someone sets `NEXT_PUBLIC_DATA_BACKEND=supabase` on Production without `EXPECTED_SUPABASE_REF` equal to the URL's project, the build fails (**Verified**, code and test) and the previous demo deployment keeps serving.
4. **Cross-environment double role (manual).** The guard cannot see another environment's variables. Confirm that the ref is **not** `EXPECTED_SUPABASE_REF` in Production while it is in an allow-list in Preview or in an operator shell (V1 checklist item 1.3.8).
5. The Production branch (`production`), its protection settings and its domain are not changed by this work. Changing Production configuration needs the owner's approval ([AGENTS.md](../AGENTS.md) protected area 1).

## 10. Conflicts and mismatches to flag

| # | Item | Where | Needed |
| --- | --- | --- | --- |
| C1 | **Preview connected to preproduction is allowed in the lifecycle's Development phase and must be retired at cutover.** This document proposes exactly such a deployment; it is allowed now but must appear in the cutover inventory and be **deleted** (not only disconnected) at cutover steps 1, 3 and 5, because an immutable deployment keeps its database URL and keys and changing variables does not change it ([INFRASTRUCTURE_LIFECYCLE.md](INFRASTRUCTURE_LIFECYCLE.md) cutover 5; [DEPLOYMENT.md](DEPLOYMENT.md) cutover step 3). | Lifecycle, DEPLOYMENT | Keep the inventory below. |
| C2 | **Owner-selected Preview demo mode (20 October) versus a connected deployment.** [DEPLOYMENT.md](DEPLOYMENT.md) "Environments" says Preview is browser demo by owner selection, while its table in the same section still lists Preview as using the DCMUN project. The two statements disagree; this proposal needs an explicit owner decision (D1), not an inferred one. | DEPLOYMENT | Owner decision; align the table. |
| C3 | **Variable scope.** Option A would connect every PR and branch Preview, multiplying immutable deployments that must be deleted at cutover and widening who can write synthetic data. | DEPLOYMENT cutover step 3 | Use option B or C. |
| C4 | **Second Vercel project with a Production environment** ([V1_RELEASE_CHECKLIST.md](V1_RELEASE_CHECKLIST.md) item 1.10.3, [STAGING_REHEARSAL.md](STAGING_REHEARSAL.md) "Staging project"). That project's Production deployments are built with `VERCEL_ENV=production`, so the guard requires `EXPECTED_SUPABASE_REF` to be the ref: the ref would hold the production role in Vercel while being a test target in the operator's shell, against lifecycle safeguard 3. | Lifecycle safeguard 3; guard design | Owner ruling before any use. |
| C5 | **Write isolation is not implemented.** A connected Preview can write with the publishable key and any valid session ([ISOLATION_DESIGN.md](ISOLATION_DESIGN.md), checklist 1.4). Acceptable on synthetic data in the Development phase only; the deployment must be gone before real data. | Lifecycle safeguard 6 | None now; retirement at cutover. |
| C6 | **Protection versus public routes.** Production is planned to be public for delegates' phones, Previews protected (item 1.3.7). A protected connected deployment cannot be reached by an unauthenticated phone, so QR tests from phones need a shareable link or bypass URL. | V1 checklist 1.3.7, 1.9.1 | Owner approval of the protection plan. |
| C7 | **Stale script comments** say "the DCMUN development project by default" ([`scripts/remote-context.mts`](../scripts/remote-context.mts), [`scripts/rehearsal-identities.mts`](../scripts/rehearsal-identities.mts)) although no project is a default (checklist item 1.3.9). | Scripts | Part of the alignment change (checklist 1.12). |
| C8 | **The numbering verification (migration 27) and this deployment are separate decisions.** The migration procedure needs no Vercel change; it uses a local build or this deployment only for the signed-in browser checks ([NUMBERING_HOSTED_VERIFICATION.md](NUMBERING_HOSTED_VERIFICATION.md)). | New | None. |

### Inventory to keep for cutover (Proposed)

Record, for every connected deployment: Vercel deployment id, immutable URL, branch URL and any alias, build commit, date created, the variables it was built with (names only), who created it, and when it was deleted. Without this the cutover step "retire or delete every old connected Preview" cannot be shown to be complete.

## 11. Rollback and teardown

A deployment rollback restores an application build; it does not change the database ([DEPLOYMENT.md](DEPLOYMENT.md) "Rollback"). For this deployment:

1. **Stop new connected builds (Proposed).** Remove the branch-scoped variables, or set `NEXT_PUBLIC_DATA_BACKEND=local` for that branch, and redeploy: new builds are demo. **Existing deployments keep the environment they were built with**; changing variables does not disconnect them.
2. **Disconnect existing deployments (Proposed).** Delete each recorded deployment and alias (the inventory under section 10). Verify an old immutable URL is gone ("deployment not found"). Protection alone is not sufficient ([DEPLOYMENT.md](DEPLOYMENT.md) cutover step 3).
3. **Revoke tester access (Proposed).** Revoke the synthetic codes and grants (revoke-only SQL in [NUMBERING_HOSTED_VERIFICATION.md](NUMBERING_HOSTED_VERIFICATION.md#85-revoke-only-cleanup), or the app's revoke with devices). Deletion of test data is the guarded cleanup at cutover.
4. **Rotate `SUPABASE_SECRET_KEY`** if it was ever set for this deployment (owner action in the Supabase dashboard).
5. **Production.** Not involved, so no rollback is needed. If a variable ever reaches Production by mistake, remove it and, if a deployment was built, Instant Rollback to the recorded demo deployment ([DEPLOYMENT.md](DEPLOYMENT.md) "Rollback"). Instant Rollback applies to production deployments only; a Preview is not rolled back, it is replaced or deleted.

## 12. Approvals required and gaps

**Approvals before any step is taken** (nothing here is delegated):

* Owner: D1 to D7 above, and approval of each Vercel change (environment variables, branch, protection, any plan change), recorded with who and when. Vercel Production configuration is not part of this work and needs no change.
* Independent (Codex) review of the final decisions where they touch protected areas 1 and 2 (environments and secrets).
* Owner supplies `SUPABASE_SECRET_KEY` only if D6 is yes, directly into the Vercel Sensitive variable and an ignored local environment, never in chat or a document.
* Cutover (separate, later): deletion of this deployment and its inventory is part of the owner-approved cutover steps in [DEPLOYMENT.md](DEPLOYMENT.md).

**Gaps found while preparing this document**

| # | Gap | Effect |
| --- | --- | --- |
| G1 | `/api/health` does not report the Supabase project ref (`probe` returns build identity and check statuses only). | A deployment cannot prove, from health alone, which allow-listed project it uses. Fine with one project; the bundle check (section 7, step 5) is the real binding proof. |
| G2 | `scripts/verify-deployment.mts` and the hosted offline rehearsal have no Vercel protection bypass support; only `scripts/rehearsal-run.mts` sends `x-vercel-protection-bypass`. | They cannot be pointed at a protected deployment without extension. `DEPLOYMENT.md` says to run `verify:deployment` "from a browser session or use a bypass token", which the script does not support. |
| G3 | No standalone, read-only deployment-binding check (the bundle check lives inside the hosted rehearsal). | Step 5 of section 7 is manual until a small script (for example `scripts/verify-deployment-binding.mts` using `checkBundles`) is added, with owner approval. |
| G4 | What `VERCEL_ENV` and the health `environment` report for a custom environment is unknown. | Option C may be refused by the rehearsal tooling's `checkHealthEnvironment`. |
| G5 | Behaviour of branch-scoped Preview variables, shareable links, password protection and plan limits is documented Vercel behaviour, never observed for this project. | Confirm in the Vercel dashboard before relying on it. |
| G6 | The guard cannot detect a ref held in two roles across different Vercel environments or machines. | Manual check, section 9 item 4. |
| G7 | No deployment inventory register exists in the repository. | Needed for cutover steps 2.1 and 2.5 of [V1_RELEASE_CHECKLIST.md](V1_RELEASE_CHECKLIST.md). |

# Public QR verification before cutover

This is a **synthetic preproduction smoke**, not a load test or release approval. Run only with the owner's authorization while the single hosted project is still listed as development/staging. Do not run after promotion. The tool neither provisions a project/conference nor changes schema, keys or deployment configuration. It leaves synthetic rows behind for the separately guarded cleanup.

The old verifier's localhost:3001, deleted development fixture IDs and tracked `docs/submission-http-results.json` output have been removed. The new verifier requires explicit current inputs and creates an exclusive, mode-0600 report inside ignored `artifacts/` or `.test-sessions/`. It refuses an existing output, so every run needs a new filename.

## Inputs for the operator

1. A running app origin, either local or a reviewed nonproduction Vercel deployment/branch URL, configured for the same preproduction project with the server-only key. A remote origin must use HTTPS; custom domains and bare project aliases are refused by the existing rehearsal guard. Public redirects are refused. Do not point at the Production frontend.
2. An ignored local environment with the current `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_DATA_BACKEND=supabase`, a valid `NEXT_PUBLIC_CONFERENCE_ID` identifying the app conference that the separate synthetic fixture must differ from, the project's staging/development allow-list and `SUPABASE_SECRET_KEY`. The key is read locally and used only for the two server-only link lookups. It is never sent to the public app or written to the report. Never paste it in chat or a tracked file.
3. `QR_VERIFICATION_APP_ORIGINS`: explicit comma-separated approved nonproduction app origins, including the one being tested. `PRODUCTION_APP_ORIGINS` may list known production origins; those always refuse. Origin approvals must be updated by the operator, not inferred from a hostname looking like Preview. Existing project guards still refuse PHESMUN, configured production and unlisted refs. `VERCEL_ENV=production` also refuses.
4. A current **synthetic** conference, committee, delegation and active resolution. The committee must have distinct active resolution-submission and amendment link tokens. Its current session must match a resolution currently In Debate, so amendments are open. The tool uses that existing resolution for the amendment; it does not approve/print/start debate on its new resolution.
5. A fixture in an ignored mode-0600 JSON file. Supply the conference UUID again using `--conference-id`; a wrong fixture conference/project or protected conference is refused before any HTTP. Protection includes `NEXT_PUBLIC_CONFERENCE_ID` and `PROTECTED_CONFERENCE_IDS` using the existing rehearsal guard. The two authoritative link lookups then confirm conference, committee, submitters and the open amendment resolution **before public app requests**.

Minimal fixture (replace every placeholder with current synthetic values):

```json
{
  "version": 1,
  "purpose": "synthetic-public-qr",
  "projectRef": "<current-20-character-ref>",
  "conferenceId": "<synthetic-conference-uuid>",
  "appOrigin": "http://localhost:4319",
  "expectedAppCommit": "<optional-full-40-character-candidate-sha>",
  "resolution": {
    "token": "<current-resolution-link-token>",
    "committeeId": "<synthetic-committee-uuid>",
    "submitterId": "<synthetic-delegate-uuid>"
  },
  "amendment": {
    "token": "<different-current-amendment-link-token>",
    "committeeId": "<same-synthetic-committee-uuid>",
    "submitterId": "<synthetic-delegate-uuid>",
    "resolutionId": "<existing-in-debate-resolution-uuid>"
  }
}
```

Omit `expectedAppCommit` for an unpinned rehearsal smoke, or supply the exact candidate SHA to require the app health build identity to match. In both cases, `/api/health` must identify Preview, Development or a local build before any public POST; Production and unknown environments refuse. An unpinned run does not establish final-candidate verification.

Optional staff visibility uses **existing** separate Chair, Approval and Logistics session files; it never creates users, signs in or refreshes sessions. Add `staff: { "chair": ".test-sessions/chair.json", "approval": ".test-sessions/approval.json", "logistics": ".test-sessions/logistics.json" }` and set the publishable key. Each JSON session needs `access_token` and `expires_at` at least two minutes in the future. Each identity must have only its stated role in this conference; the Chair must be scoped to this committee. Without these inputs, staff visibility is explicitly unverified in the report, not silently passed.

## Run

Install the pinned lockfile with `npm ci`. Set the ignored environment locally; the script loads `.env.local` through Next's existing environment loader.

First run pure configuration preflight (no client, HTTP, Auth, Google request or write):

```sh
node --import tsx scripts/verify-submission-http.mts \
  --base-url http://localhost:4319 \
  --conference-id <synthetic-conference-uuid> \
  --fixture .test-sessions/public-qr.json \
  --output artifacts/public-qr/preflight.json \
  --preflight
```

Once the server key and authoritative current fixture have been prepared, omit `--preflight` and choose a new output filename. A successful preflight report says `preflight-only`; it does not satisfy checklist 1.5.1. A failed or partial smoke says `failed`, lists only completed checks and records any successful creations. Do not blindly rerun into rate limits after a partial run. Inspect and clean up the synthetic conference through the separate guarded cleanup process.

## Checks and effects

- The existing app health guard rejects Production/unknown environments and checks the exact candidate SHA if supplied.
- Both public pages render their expected form confirmation and issue no auth cookie or server key.
- Resolution create, three concurrent exact receipt retries, same-source deduplication, changed-payload rejection and old cached-title compatibility.
- Invalid Google host, wrong delegation, invalid token and an amendment token used as a resolution token are refused.
- An **empty file field** is refused as `docs_only`, with no PDF/file content uploaded. Newly created resolutions contain only synthetic Google Doc IDs.
- Amendment create, three concurrent retries, duplicate exact wording, changed-payload rejection, invalid delegation, wrong resolution, invalid token, resolution-token cross-use and missing confirmation refusal.
- If optional staff sessions were supplied, the owning Chair reads exactly one new Draft with its canonical working-document ID; Approval and Logistics cannot read the Draft.

A complete successful run creates **two resolution documents** (normal and legacy-title compatibility), their associated versions/links/receipts, and **one amendment**. It also creates duplicate-source receipt records. Retain the entire conference fixture for scoped cleanup; do not infer cleanup completeness only from the report's document codes and amendment IDs. It makes about two dozen small public POSTs, including retries and refusals; it is not a capacity test. Use fresh isolated links/delegations with no recent activity to avoid contaminating rate-limit checks. The amendment's five-per-delegation allowance must not already be exhausted.

## What remains unverified

The application currently parses and stores a Google Doc ID and relies on the Chair opening/checking access. This verifier deliberately uses synthetic IDs and never contacts Google: it does **not** prove the document exists, Anyone-with-link sharing, edit access, actual content or Google account behavior. Those need a real document opened manually in the intended Chair/Approval accounts. Historical uploaded attachments and signed Storage URLs are separate checks.

The public health endpoint does not attest its configured project or conference. App origin→project binding therefore remains the operator's reviewed deployment configuration, supplemented by unpredictable current link tokens. An origin allow-list is not proof of that deployment's backend. Lifecycle enforcement belongs to the shared project guard; this verifier does not invent a competing registry or production marker.

This smoke also leaves rate-limit thresholds, link rotation/revocation, retry after a debate/session change, physical-device offline reopening, full workflow/scoring/voting, Storage health and the 110-device rehearsal as separate gates. The existing local database tests cover several of those contracts but are not hosted proof. No tracked historical evidence is overwritten or reclassified as current evidence.

## Local verification

`tests/public-qr-verifier.test.ts` tests malformed/refused targets and inputs without any network, authoritative link mismatches before public app requests, and the complete smoke against the **real two POST route handlers** with an in-memory RPC boundary. It asserts replay/conflicts, Docs-only refusal, no Auth/Google/third-party requests, no public credentials and no secret/live token in reports. These tests do not stand in for running Next, PostgREST or a real hosted database.

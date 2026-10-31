# Final retirement - NOT DONE, waits for the owner - diagnostic attempt after NO-GO ramp
Nothing below was done on 31 October. Do not start any of it unless the owner has declared every approved run finished, in writing, and the evidence is saved and checked (run sheet section 9.2).

| Item | Status | Note |
| --- | --- | --- |
| Delete .test-sessions/fixtures/*, the 22 pool session files, rehearsal-multi-identities.json, development.json | NOT DONE, waits for owner | Also holds .test-sessions/submit-token (the GA1 submission link token), r3b-sampler.log and h3-sampler.log |
| Delete original harness reports .test-sessions/rehearsal-*.json (after sample-free copies are saved) | NOT DONE, waits for owner | Sample-free copies exist for S0, R1, R2, R3, R3b, H3 |
| Unset SUBMIT_TOKEN and VERCEL_AUTOMATION_BYPASS_SECRET in shells | NOT DONE | SUBMIT_TOKEN was never exported to a shell; it lives in the private file above |
| Delete the Preview deployment(s); retire connected Previews, server key, connectors | NOT DONE, waits for owner | Preview munos-jij0int7d-dcmun.vercel.app (dpl_2UYk8wYf7zyudbDjetsbuCv3gBTR) |
| Guarded deletion of labelled LOAD TEST conferences, Storage objects, test Auth users (docs/SYNTHETIC_CLEANUP.md) | NOT DONE, waits for owner | Fixture conferences 573cfbeb-d3ed-4cf5-b418-7d36326f69c8 (A) and 1e6bb11f-95c2-4acc-9849-2047818cbdd4 (B) |
| Revoke Auth sessions and refresh capability; record last token issuance; retire legacy keys, Storage capabilities, cloud connectors | NOT DONE | The 22 pool Auth sessions stay valid after the revoke-only cleanup. Last pool token refresh: 13:55:55 UTC. Revoke-only cleanup of A and B was applied at 14:36-14:37 UTC (see cleanup/fixture-*-revoke-verify.txt) |
| Token wait-out: 3,600 s from the last possible test-token issuance plus margin | NOT DONE | |
| Backup/restore evidence; acceptable data-loss window decision | NOT DONE | PF8 recorded as "synthetic data only, owner accepts"; PITR off is a state, not an approval |
| Registry/marker transition to production; exact-SHA release approval; Production deployment; first Executive bootstrap | NOT DONE | John Paul Ribeiru approves releases |
| Version, tag or Production configuration change | NONE made | |

Also left in the operator container (cloud session, ephemeral): .env.local (public configuration only, no secret key) and a local PostgreSQL 17 install used for tests.

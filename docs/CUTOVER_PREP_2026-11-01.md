# Cutover preparation checklist, 1 November 2026

A simple, ordered list for the production cutover. It adds no approval and changes no procedure: [INFRASTRUCTURE_LIFECYCLE.md](INFRASTRUCTURE_LIFECYCLE.md) governs, and every cutover step is human-controlled and recorded. Evidence for the capacity run: [load-2026-11-01 summary](evidence/load-2026-11-01/SUMMARY.md).

Dates: 2 November is for fixes only. The 48-hour freeze starts 3 November. The conference is 5 to 7 November.

## Verified on 1 November

- [x] Candidate `032daa5`; staging ledger at 37 migrations through `20261101090000_snapshot_committee_prefilter`.
- [x] Staging is Pro, Small compute, 90 connections. PITR is **off** and the last backup was 31 October 08:52 UTC.
- [x] H3 (110 staff, 30 minutes, 19 committees) passed as a READINESS RUN. R3 passed.
- [x] 0 live grants on any conference, both load fixtures revoked, original-conference fingerprint unchanged.
- [x] Staging holds nine conferences, all synthetic; 0 non-test grants. No real conference data has been entered.
- [x] The owner deleted the metrics key, rotated the Vercel bypass secret, closed the operator terminals and deleted the session files.

## Retire the connected Previews (owner, Vercel dashboard)

Claude's Vercel connector cannot delete deployments. In the Vercel dashboard, project `munos`, Deployments, filter branch `codex/preproduction-connected`, delete each:

| Deployment | Built from |
| --- | --- |
| `dpl_AgKbB2jJNzS3hpnMhvPCS63JNmwg` (`munos-cj59l3s5l-dcmun.vercel.app`) | `032daa5`, 1 Nov (the H3 candidate) |
| `dpl_2UYk8wYf7zyudbDjetsbuCv3gBTR` (`munos-jij0int7d-dcmun.vercel.app`) | `288c723`, 31 Oct |
| `dpl_EQboPWUsbX4MfMGYYxekPJ8p1JPu` (`munos-7hptv216n-dcmun.vercel.app`) | `4db21e5`, 26 Oct |
| `dpl_F9E3JM5kvrzE3xAgoi7ChA2LPrGW` (`munos-92nfadxi8-dcmun.vercel.app`) | `5911d03`, 26 Oct |
| `dpl_7XxtobS1AYLP4gdTtD4GriuWACAw` (`munos-bf56arr56-dcmun.vercel.app`) | `e90686b`, 25 Oct |
| `dpl_F9e5BBiNSpmRUoW4wAT4ayYzLzvC` (`munos-pkwytp1dc-dcmun.vercel.app`, target `staging`) | `3e282f7`, 25 Oct |

The branch alias `munos-git-codex-preproduction-connected-dcmun.vercel.app` goes with them. Then confirm the list for that branch is empty. Do not push to that branch name again.

## Cutover steps (human-controlled, in order, from the lifecycle document)

1. [ ] Freeze the candidate SHA and the migration ledger. Reconcile synthetic work and keep the evidence.
2. [ ] Guarded cleanup of synthetic records on the verified preproduction target. The two open submission links left on the 20 and 21 October test conferences are part of this (the original conference is protected and goes through the reviewed cleanup tooling only). Confirm no real data.
3. [ ] Disable cloud-agent access to the project: Supabase and Vercel connectors, access tokens, secret and service keys, database roles. Revoke agent credentials and refresh sessions.
4. [ ] Revocation wait-out: wait the confirmed 3,600 seconds from the last possible test-token issuance before opening real-data entry.
5. [ ] Remove hosted values from Preview, Development and branch overrides, and from PR CI and agent environments. New Previews build in demo mode.
6. [ ] Promote the lifecycle record: update `config/project-lifecycle.json` and the server lock to production, remove the ref from the staging and development lists, set `EXPECTED_SUPABASE_REF` for Production only. Record time, operator, approvals, ref, Small size, SHA, ledger and backup state.
7. [ ] Release the approved production build from the verified revision with new Production-scoped secrets. Check target, SHA and health with a non-destructive check. Release approval is John Paul Ribeiru's.
8. [ ] Only after the sign-offs: bootstrap the real Executive, then issue real grants, codes and QR links.

## Decisions and sign-offs still open

- [ ] Independent reviewer sign-off and release approver sign-off on the capacity evidence.
- [ ] Backups: PITR is off. Decide before any real data is entered whether to turn it on, and record the choice.
- [ ] Real-browser functional checks on the exact candidate (Chair reconnect, roll-call correction, immutable ballot eligibility, speeches and points, Approval and printing, public resolution and amendment access, revocation).
- [ ] Not measured in the capacity run: disk IO and swap, and real Realtime delivery (the runner simulates it). Check both in the dashboard during the first live session.
- [ ] Support-role read latency (Admin, Executive and Approval snapshots, 2.7 to 3.4 s p95 at 110 staff) is the next place to improve if time allows. The planned fix is delta reads, documented in [PERFORMANCE_FOLLOWUPS_2026-10-31.md](PERFORMANCE_FOLLOWUPS_2026-10-31.md).

# Conference write path — owner decision, 26 October 2026

Zuhayr Siddique approved the existing direct RPC write path for the 5–7 November conference in this project's conversation on 26 October 2026 (Qatar time).

The question explicitly proposed deferring the gateway and signed attestation and stated the residual risk: a holder of a valid staff token can make permitted calls outside the Production website. The owner answered:

> Approve the existing direct RPC path for this conference

The conference release therefore retains `SupabaseTransport` → PostgREST RPC with the individual user's token. The production-only gateway, its operation-bound write proofs, and signed attestation/freshness system are deferred. This is an accepted scope change, not proof that the original gateway/isolation requirements have been implemented. Checklist 1.4.4 and the gateway denial proof in 1.4.7 are deferred for this conference.

Codex acknowledges the accepted risk: permitted calls are not cryptographically bound to the Production deployment. Origin, Referer, CORS and the publishable key do not provide that binding. Role, committee, conference, grant expiry/revocation, RLS, mutation receipts, conflict checks and the durable outbox remain required.

This decision does not waive the remaining lifecycle controls or mark them verified. In particular, the database lifecycle lock, owner-controlled lifecycle record and stale-target protections in checklist 1.4.1–1.4.3 remain unresolved. The existing environment allow-lists are not a signed registry or a server-enforced lock.

It does not authorize spending, a load run, synthetic-data deletion, Production promotion, real-data entry, a version/tag change or release approval. Those still need their specified evidence and approvals. Cloud-agent access ends at promotion; connected immutable Previews and test credentials must be retired before real data is entered.

Related: [conference release plan](CONFERENCE_RELEASE_PLAN.md), [lifecycle](INFRASTRUCTURE_LIFECYCLE.md), [release checklist](V1_RELEASE_CHECKLIST.md), [preproduction verification](PREPRODUCTION_CONNECTION_2026-10-25.md).

## Token wait-out and load window — owner confirmations

On 26 October the owner accepted the wait-out approach and confirmed the Supabase Auth access-token expiry setting is **3,600 seconds**. This is an owner report of the dashboard setting, consistent with the approximately one-hour tokens observed in the hosted probe; it is not a new hosted configuration change.

At cutover, stop test-token issuance and refresh, revoke test codes, grants and Auth sessions, and record the last possible test-token issuance time. Real-data entry must wait at least 3,600 seconds from that time, plus the operational clock margin recorded by the operator. Check for older tokens issued under a longer previous expiry and wait until their expiry as well, or invalidate them separately. If issuance resumes, restart the wait. API/server keys and connected Preview retirement remain separate controls. No wait has started and no cutover has occurred.

The owner also confirmed **31 October** for the paid Small-compute upgrade and full hosted load run. Prepare the exact commands and gates now; do not upgrade early or run the hosted workload under this timing confirmation alone. The release packet's spend, target, fixture and go/no-go controls still apply.

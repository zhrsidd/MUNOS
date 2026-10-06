# Claude stack review — 6 October 2026

Reviewed heads: #1 `61f4a5f`, #2 `a9a6169`, #3 `9cf9360`, #4 `8a49051`, #5 `217ee2c`.

| PR | Review result |
| --- | --- |
| 1 Deployment | Accepted groundwork. CI, pinned dependencies, Mumbai region, public build identity and secret separation are appropriate. No deployment performed. Added single-flight health probing to make its per-instance request bound true under concurrent requests. |
| 2 System health/runbook | Accepted. Uses local sync state; service probing only on the health screen. Recovery files remain explicit. Corrected the generic error wording so revoked/expired access is not reported as a storage failure. |
| 3 Google Docs submissions | Accepted with integration fixes below. Canonical Google Doc IDs, strict host validation and rebuilt URLs prevent arbitrary navigation. Committee tokens authorize only submission and limited delegation choices, not staff access. Google Docs remains the editor. |
| 4 Schedule import | Accepted. Atomic bounded import, conference authorization, time-zone conversion, duplicate detection and nullable end times. Imported sessions remain scheduled; the new explicit Chair selection is authoritative. |
| 5 Group photos | Accepted with revision protection. Local time-derived reminders survive reconnect; acknowledgements use the existing outbox and scoped notifications. No added polling service. |

## Security and reliability corrections

- Draft resolution links and fallback files previously bypassed parent document lifecycle visibility for Approval/print roles. Both now require a visible parent document/version. Unreferenced files cannot be read by staff.
- Submission UUID replay previously accepted different payloads or another committee token. Receipts now bind link, committee, submitter, title and source; a UUID lock serializes cross-committee retries. Duplicate submissions also retain a receipt. Rotation is rechecked after acquiring the committee lock.
- An ambiguous database response previously deleted a possibly committed upload. Failure now retains bytes for recovery. Content-hash paths prevent a changed retry from reusing wrong bytes. Cleanup only follows a confirmed duplicate with a different canonical storage key.
- Resolution-link edits, photo edits and submission-link changes now compare authoritative revisions/fingerprints under lock. Missing or stale preconditions fail visibly and retain the outbox action.
- Cached recovery state cannot flush under expired access or a different identity. Pending changes remain exportable.

No RLS policy was widened. No anonymous table grants or authenticated direct writes were added. Server submission functions remain executable only by service_role; browser clients use the publishable key and explicit role grants.

## Extension architecture decision

Keep `operations_snapshot` and `apply_operations_mutation`. They isolate Claude-owned extensions while sharing the core outbox, receipt store and compact notifications. Core and extension reads are two parallel RLS-scoped transactions, not one atomic cross-module snapshot; transient concurrent differences reconcile on the next read and every write validates server state. Avoid another client state store or independent sync mechanism. An aggregate snapshot can be evaluated with measured load evidence later.

Current-session and core procedure data extend the core snapshot/RPC. Google Docs content is not parsed, copied into structured clauses, or edited by MUNOS. Drive automation and amendment submission remain deferred. Fallback Storage is private and optional.

## Follow-up for Claude

Preview/staging rehearsal, deployment protection, school-network distinct-device enrollment and load, monitoring, rollback drill, future Shared Drive mirroring, and reconciliation of unreferenced fallback uploads. Public submission rate limiting is currently per committee link; assess platform rate controls during Preview load rehearsal. No need to rewrite the accepted features.

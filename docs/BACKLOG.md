# Remaining product and release work

The initial backlog was superseded by the approved core integration. Staff access codes, central sessions, the amendment QR workflow and System health in every staff workspace (PR #12–#16), QR resolution submission, shared current-session selection, school group-photo reminders and configurable Security Council veto rules are implemented, with verification limits recorded in [INTEGRATION_REVIEW.md](INTEGRATION_REVIEW.md).

Public workspace labels are **Admins** and **Executive**; internal role identifiers and routes are unchanged. Award rubric controls are retired; award discussion uses alphabetical factual participation context and remains a human decision.

Still deferred:

- Drive automation for Approval copies, PDF snapshots and archive mirroring; its identity is separate from human Chair sharing.
- Amendment editor, document parsing and automatic amendment application. (Amendment QR submission and the Chair amendment workflow exist since PR #13; Chairs still edit the working Google Doc manually.)
- Motions, announcements and general logistics requests.
- Legacy Google Docs `resourcekey` preservation in canonical links (low priority).

Release work remains: verify the real public HTTP/file-upload path, rehearse staff devices and separate delegate QR bursts, address read-tail latency, establish protected staging/production, and complete monitoring/rollback drills. PR #6 remains draft and must not be merged as part of this integration.

Infrastructure work belongs to Claude by default; core schema/repository work belongs to Codex. Shared architecture changes are serialized and cross-reviewed.

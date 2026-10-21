# Google Docs sharing model

Status: current. Human sharing of Google Docs only. Drive automation, mirroring and service-account access were
considered and **retired**; no Google credentials, Drive API code or Shared Drive integration exists or is planned.

## 1. Product model: staff software with one public form

Conference OS is **staff operations software**. Its users are Chairs, the Approval Panel, Admins and the Executive. **Delegates are not users**: no accounts, dashboards, committee pages, schedules, participation or voting views, and no sign-in.

The only delegate-facing surface is the **isolated resolution submission form** reached by a committee QR code (`/submit/{token}`). Think of it as a small public form attached to Conference OS.

Verified in the current code (`main`), and re-verified over real HTTP against the development project (docs/INTEGRATION_REVIEW.md, docs/submission-http-results.json):
- `/submit/*` renders **without** the staff workspace provider, device storage (IndexedDB) or the service worker (`components/conference-shell.tsx`, `components/offline-shell.tsx`).
- The page and `POST /api/submissions` are **server-mediated**. The browser never talks to Supabase. The server uses `SUPABASE_SECRET_KEY` with `persistSession: false` to call two `service_role`-only functions.
- **No Supabase Auth session, anonymous sign-in or cookie is created for a delegate.** A burst of delegate submissions therefore does not consume Supabase Auth's per-IP anonymous sign-in limit.
- The form shows only: committee code and name, conference name, the sharing text, a country/delegation selector (country and flag only — no names or emails), Google Doc link and a confirmation checkbox (no resolution title since 21 October 2026: a posted `title` is ignored and the server stores the fixed compatibility title, [UI_OVERHAUL.md](UI_OVERHAUL.md#title-free-resolutions-handoff-21-october-section-2-contract-change--21-october-2026)). **Google Docs only**: since 20 October 2026 the form and `POST /api/submissions` refuse files (§7). No attendance, roster, participation, votes, notes, workflow history or staff data.

## 2. Delegate submission flow (target)

```
Write resolution in Google Docs
→ Share → General access: "Anyone with the link" → role "Editor" → Copy link
→ scan committee QR → choose delegation → paste link
→ tick "I have made sure the Chairs can edit this document." → Submit → done
```

No login, no other Conference OS navigation.

**Fallback when the delegate's school blocks "Anyone with the link"**: share the Doc directly with one of the committee's Chairs, as listed on the form.

**No committee mailbox or Google Group.** Earlier designs (PR #6, first draft) proposed sharing addresses such as `ga1@dcmun.org` backed by a Group. That is dropped: link editing covers the normal case, the Chairs' own addresses cover the fallback, and automation access is handled separately (§5).

### Recommended form copy

> **Before you submit, let the Chairs edit your document**
> Recommended: in Google Docs, **Share → General access → Anyone with the link → Editor**, then **Copy link**.
> If your school doesn't allow that, share the document directly with **one** of your Chairs:
> Chair A — chair.a@example.org · Chair B — chair.b@example.org · Chair C — chair.c@example.org
>
> ☐ I have made sure the Chairs can edit this document.

## 3. Human Chair access

Chairs open the working Doc in their own browser, signed in to their own Google account.

| Delegate set… | Chair can edit? | Notes |
| --- | --- | --- |
| Anyone with the link → **Editor** | Yes — Chairs should be signed in to their own Google account | Personal Gmail owners can always choose this. A school Workspace may restrict or forbid it (§6). |
| Anyone with the link → **Viewer/Commenter** | View only | The Chair marks *Can't access* (wrong level) and asks for Editor. |
| Restricted + shared to a Chair's email | Yes, that Chair only | Other Chairs need their own share or the first Chair's help. |
| Restricted, not shared | No ("Request access") | *Can't access*. |
| "People in <school> with the link" | No (Chairs are outside that school) | The school allows link sharing only internally → direct share with a Chair, if external sharing is allowed at all. |

Conference OS does **not** check sharing; it never calls Google for the human workflow. The Chair's *Can't access* / *Access fixed* buttons record the outcome. Conference OS must not show "access OK" unless a Chair marked it.

## 4. School Workspace restrictions — expected behaviour

| Delegate's account | "Anyone with the link → Editor" available? | Direct share to a Chair's Gmail/other domain? |
| --- | --- | --- |
| Personal Gmail | Yes | Yes |
| DCMUN Workspace | As DCMUN policy allows | As policy allows |
| Other school, external sharing ON | Usually yes (admin may still disable public links) | Yes |
| Other school, link sharing limited to the school | **No** (only "People in <school> with the link") | Possibly, if external sharing to named users is on |
| Other school, external sharing OFF or allowlisted domains | **No** | **No** (unless DCMUN's domain is allowlisted) |

For the last two rows, the delegate's options are: (1) share directly with a Chair if allowed, or (2) copy the text into a personal Google account's Doc if school rules permit. File uploads are no longer accepted (§7); a delegate with neither option speaks to their Chair, who can create the Doc on their behalf.

## 5. Submission security review (current implementation, PRs #3–#5)

| ID | Severity | File / area | Why it matters | Recommended fix | Owner |
| --- | --- | --- | --- | --- | --- |
| S-1 | ~~Medium~~ **Resolved in #7** | `submission_links.share_with`, form copy in `components/operations/submission-form.tsx`, room sheet, Executive *Submission links* | One free-text "share with" address per committee implies a committee mailbox, duplicates Chair assignments that already live in `committee_staff`, and tells delegates to share with a single address instead of "Anyone with the link → Editor" | Form: lead with Anyone-with-link → Editor, list the committee's assigned Chairs as fallback, change the checkbox to "I have made sure the Chairs can edit this document." Source Chairs from `committee_staff` → `staff`. **Interim with no code change:** the Executive enters "Chair A — a@…, Chair B — b@…" in the existing field. | CLAUDE (form, room sheet, Executive screen) + CODEX (data, see S-2) |
| S-2 | ~~Medium~~ **Resolved in #7** (`staff` contact email; assigned Chairs exposed only via the service-only lookup) | Core `public.staff` | Staff records have a name but **no email**, so the public form cannot list Chair contacts from authoritative data | **CODEX REVIEW REQUIRED — DESIGN ONLY:** add an optional contact email to staff (or `committee_staff`), editable by the Executive, and expose `{name, email}` of that committee's Chairs through `public.submission_link_info` (service_role only) | CODEX (schema/RLS), CLAUDE (link-info + form) |
| S-3 | Low — **still open** | Chair *Delegate submissions* card (`components/operations/resolution-links.tsx`) | The *Can't access* hint says "share with {sharing address} as an Editor", which repeats the committee-address assumption | Change to "Ask the delegation to set Anyone with the link → Editor, or share it with you as Editor." | CLAUDE |
| S-4 | Low — **still open** (in docs/BACKLOG.md) | `lib/submissions/google-doc.ts` | The `resourcekey` query parameter is dropped. Older link-shared files that need a resource key would open as "Request access" for Chairs and fail for automation. Rare for new resolutions. | Accept and validate `resourcekey` (`[A-Za-z0-9_-]{1,100}`), store it next to the id, append it to the rebuilt URL and send it as `X-Goog-Drive-Resource-Keys` | CLAUDE (+ one nullable column in Claude's `resolution_links`/`resolution_submissions` migration) |
| S-5 | Low (accepted) | Public form delegation selector | Anyone holding a committee's link can submit as any delegation of that committee | Acceptable for a conference: the Chair reviews every submission and the link is room-scoped, rate-limited and rotatable. Mention in Chair training. | — |
| S-6 | Info | Duplicate detection | The same Doc id twice for one committee returns the original reference; the same Doc can be submitted to two committees | Intended. | — |
| S-7 | Info | Token, scoping, URL handling | Verified: 128-bit tokens; committee-scoped; the delegation must belong to that committee; only the Doc id is stored and the URL is rebuilt, so no open redirect or arbitrary URL rendering; idempotent retries; file fallback validates signature, size and path; `/submit` sends `no-referrer` and `noindex`; no delegate auth sessions | — | — |
| S-8 | Info | Approval copy link | Only validated Google Doc ids are accepted and links are rebuilt; no arbitrary URLs | — | — |

S-1 and S-2 were implemented by Codex in #7 (legacy `share_with` is retained only for compatibility and is not shown as Chair access). S-3 (the Chair's *Can't access* hint in `components/operations/resolution-links.tsx` still names the legacy sharing address) and S-4 (resource keys) remain small follow-ups; neither blocks the rehearsal.

## 7. Google Docs-only submissions and access checks — 20 October 2026

Owner priority 1 in [UI_PRIORITY_PASS.md](UI_PRIORITY_PASS.md#remaining-priority-order). Part A is implemented; part B is a specification only.

### A. Implemented: native Google Docs only for new submissions

- The public form has no file input or upload toggle, and says up front that PDF and Word files are not accepted.
- `POST /api/submissions` refuses any request carrying a `file` part with `docs_only` (400), before configuration, link lookup, storage or the database are touched, even when a valid Doc link is also present. The request body cap is 64 KB.
- Links Google marks as a Word file opened in the Docs editor (`rtpof=true`) are refused with instructions to use **File → Save as Google Docs** and share the new document.
- **Historical attachments are preserved.** Files uploaded before this change stay in the private `resolutions` bucket, remain readable by staff through *Open uploaded file* (Storage RLS and signed URLs unchanged), and `public.submit_resolution` keeps its file parameters for those rows. No migration.

### B. Specification: automated access check (not implemented)

**What it can establish.** One unauthenticated server-side request for the document from Conference OS can show only that *anyone* can open the Doc without signing in. It cannot show:

- **the role** (Viewer, Commenter or Editor). An anonymous request sees the same content for all three, so the check must never say "Chairs can edit";
- **a direct share to a Chair**: a Doc shared only with a Chair's email looks *restricted* to an anonymous request, yet the Chair can edit it. *Restricted* is therefore never a rejection;
- **native type with certainty**: URL shape can disprove a native Doc (`rtpof=true`, Drive file links), never prove it. A successful anonymous export of the Doc as text is the bounded positive signal;
- **anything signed in**: a Chair opening the Doc while signed in proves nothing about anonymous access, and Conference OS holds no Google credentials. None will be added (Drive automation stays retired).

**States** (stored per working Doc with `checkedAt`):

| State | Meaning | Shown as |
| --- | --- | --- |
| `verified` | anonymous request succeeded: anyone with the link can **open** it (role unknown) | "Anyone with the link can open this. Edit access not confirmed." |
| `restricted` | Google required sign-in or refused | "Not open to anyone with the link. Ask for Anyone with the link → Editor, or a direct share to a Chair." |
| `unable` | timeout, rate limit, network or unexpected response | "Could not check. Open it yourself or recheck." |

**Bounds.** Server-side only (never from the delegate's or Chair's browser); one request per check, 5 s timeout, no redirects followed beyond recognising a sign-in redirect, response size cap, no document content stored or logged. Per-committee and global rate limits. Run once at submission (never blocking it) and on an explicit **Recheck** at the Chair → Approval handoff; no polling.

**Relationship to the Chair's record.** The Chair's existing *Can't access* / *Access fixed* marks remain the authority for "Chairs can edit". The automated state is advisory and shown next to it with its timestamp.

**Needed before implementation:** a reviewed forward migration for the state and timestamp on `public.resolution_links` (or a sibling table), RLS unchanged in scope, an operations command for Recheck under the existing mutation-receipt contract, a probe on staging against real Docs in each sharing mode (§4 matrix), and confirmation that Vercel functions may reach `docs.google.com` and that Google's anonymous responses are stable enough to classify. This is a protected change (schema and outbound integration) and needs independent review.


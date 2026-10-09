# Google Workspace access model

Status: research and design for future Drive automation. The human-facing parts are **implemented on `main` (#7)**: the QR form recommends *Anyone with the link → Editor*, lists the committee's **assigned Chairs and their contact emails** (Executive → Chairs & staff; migration `20261006073442_staff_chair_contacts`), and uses the checkbox "I have made sure the Chairs can edit this document." No Google resources, credentials or Drive API code exist. Sources are listed at the end; items Google does not document precisely are marked **verify in setup** and appear in the setup checklist.

## 1. Product model: staff software with one public form

Conference OS is **staff operations software**. Its users are Chairs, the Approval Panel, Admins and the Executive. **Delegates are not users**: no accounts, dashboards, committee pages, schedules, participation or voting views, and no sign-in.

The only delegate-facing surface is the **isolated resolution submission form** reached by a committee QR code (`/submit/{token}`). Think of it as a small public form attached to Conference OS.

Verified in the current code (`main`), and re-verified over real HTTP against the development project (docs/INTEGRATION_REVIEW.md, docs/submission-http-results.json):
- `/submit/*` renders **without** the staff workspace provider, device storage (IndexedDB) or the service worker (`components/conference-shell.tsx`, `components/offline-shell.tsx`).
- The page and `POST /api/submissions` are **server-mediated**. The browser never talks to Supabase. The server uses `SUPABASE_SECRET_KEY` with `persistSession: false` to call two `service_role`-only functions.
- **No Supabase Auth session, anonymous sign-in or cookie is created for a delegate.** A burst of delegate submissions therefore does not consume Supabase Auth's per-IP anonymous sign-in limit.
- The form shows only: committee code and name, conference name, the sharing text, a country/delegation selector (country and flag only — no names or emails), title, Google Doc link, a confirmation checkbox and the optional file fallback. No attendance, roster, participation, votes, notes, workflow history or staff data.

## 2. Delegate submission flow (target)

```
Write resolution in Google Docs
→ Share → General access: "Anyone with the link" → role "Editor" → Copy link
→ scan committee QR → choose delegation → enter title → paste link
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

## 4. The key question: does "Anyone with the link" grant API access?

**Short answer: yes for an authenticated Google identity, but it is not automatic and not guaranteed.**

- *Anyone with the link* is a Drive permission of `type=anyone` with `allowFileDiscovery=false`. It applies to any principal that presents the file id. A server-side Drive API client authenticated as **some Google identity** (service account or user) can call `files.get` / `files.copy` on that id and is evaluated as "anyone", receiving the link's role (reader / commenter / writer).
- The client must still **authenticate**. A bare document id gives nothing without credentials. (An API key can read public files anonymously, but cannot copy into a Shared Drive.)
- **Resource keys:** some files shared by link need an extra *resource key* (`?resourcekey=…` in the URL, sent as `X-Goog-Drive-Resource-Keys: fileId/key`) for anyone who has not opened them before. Google applied this in 2021 to older link-shared files (mainly content uploaded before late 2017); a resolution written for this conference will not normally have one. *Finding S-4:* the current parser discards query strings, including `resourcekey`.
- **The owner's domain policy wins.** If the delegate's school limits link sharing to its own users, sets an allowlist of trusted domains, or disables external sharing, an outside identity — a Chair's Gmail **or our automation identity** — gets no access, whatever the link says. Google also documents that service-account domains (`*.gserviceaccount.com`) **cannot** be added as trusted domains.
- **Direct shares to Chairs do not reach the automation identity.** If the delegate shared only with Chair A, the automation cannot read the Doc. It then falls back to "Needs attention" (§8), and the Chair copies manually or shares the Doc on.

**Conclusion:** "Anyone with the link → Editor" from personal Gmail and permissive schools lets automation read and copy the Doc. The integration must still treat every source Doc as *possibly inaccessible* and degrade gracefully.

## 5. Automation identity options

Human Chair access and automated Drive access are **separate concerns**. The automation only needs to (1) read/copy a delegate Doc when permitted, (2) create the conference-owned Approval copy in the right committee folder, (3) later create PDF snapshots and exports.

| | **A. Service account** (Google Cloud) | **B. Workspace automation user** (e.g. `conference-os@dcmun…`) | **C. Service account + domain-wide delegation** | **D. No automation (manual copy)** |
| --- | --- | --- | --- | --- |
| Anyone-with-link → Editor Doc | Yes (authenticated "anyone") | Yes | Yes | n/a (Chair copies) |
| Copy into DCMUN Shared Drive | Yes, **if it is a Shared Drive member**. A service account has no Drive storage and cannot own files, so copies **must** go to a Shared Drive. | Yes, as a member | Yes (acts as an impersonated DCMUN user) | Chair makes the copy |
| Doc owned by personal Gmail | Works if link-shared or shared with it | Works if link-shared or shared with it | Same — only helps for files *DCMUN users* can reach | Works |
| Doc owned by another school's Workspace | Works only if that school allows external link sharing | Same | Same | Works only if the Chair can open it |
| School disables external sharing / Anyone-with-link | No access | No access | No access | Delegate uses file upload or a personal copy |
| Shared only with a Chair | No access | No access | **Yes**, by impersonating that Chair's DCMUN account (only if the Chair is a DCMUN Workspace user) | Works |
| Credential | Keyless: **Vercel OIDC → Workload Identity Federation**, impersonating the service account; or a JSON key (Sensitive env var) | OAuth refresh token for an internal OAuth app (stored server-side); a real account with a password and 2-Step Verification to protect | Service-account key or WIF + Workspace admin grants domain-wide scopes | None |
| Workspace admin setup | Add it as a Shared Drive member. **Verify in setup:** DCMUN's policy allows that external member (service accounts are not part of the Workspace domain). | Create a licensed user; add it to the Shared Drive; internal OAuth consent (no Google verification for internal apps) | Super-admin authorises client id + scopes for the **whole domain** | None |
| Risk | Smallest blast radius; no human login; nothing to rotate with WIF | A real, licensed mailbox to protect; refresh token can be revoked by password/policy changes | Can act as **any** DCMUN user — far more power than needed | Manual work; no automatic copies |
| Needed? | — | — | **No.** Only for reaching files shared to individual DCMUN Chairs; acceptable to handle manually | Always available |

**Shared Drive membership.** Google documents that service accounts *can* be Shared Drive members. They are not part of the DCMUN Workspace domain, so a Shared Drive or organisation that blocks outside members may refuse it (verify in setup). A Workspace user (option B) is internal and avoids that question.

**Propagation.** New Shared Drive memberships and link-permission changes usually apply within seconds to minutes. A Doc whose sharing changed moments before submission may briefly return 403/404. Retries with backoff (§8) cover this; never conclude "inaccessible" from one attempt.

## 6. School Workspace restrictions — expected behaviour

| Delegate's account | "Anyone with the link → Editor" available? | Direct share to a Chair's Gmail/other domain? | Automation access |
| --- | --- | --- | --- |
| Personal Gmail | Yes | Yes | Yes via link |
| DCMUN Workspace | As DCMUN policy allows | As policy allows | Yes (Shared Drive member; link or direct) |
| Other school, external sharing ON | Usually yes (admin may still disable public links) | Yes | Yes via link |
| Other school, link sharing limited to the school | **No** (only "People in <school> with the link") | Possibly, if external sharing to named users is on | **No** |
| Other school, external sharing OFF or allowlisted domains | **No** | **No** (unless DCMUN's domain is allowlisted) | **No** (service accounts can't be allowlisted) |

For the last two rows, the delegate's options are: (1) share directly with a Chair if allowed, (2) **upload a PDF/Word file** (the existing fallback), or (3) copy the text into a personal Google account's Doc if school rules permit. The form already offers (2).

## 7. Shared Drive behaviour

- **Ownership:** files in a Shared Drive belong to the organisation, not a person. A copy made into the DCMUN Shared Drive is owned by DCMUN, so the delegate cannot later revoke or delete it (their working Doc remains theirs).
- **Copying external Docs:** a copy needs read access to the source and write access to the destination. Copying is blocked when the owner has turned on `copyRequiresWriterPermission` ("disable download, print and copy for commenters and viewers") **and** we are only a reader or commenter. With **Editor** access this restriction does not apply.
- **Minimum role: Contributor** (`writer`): view, edit, create files and folders. It **cannot move items or move them to Trash**, which matches "never delete or move" (correction: earlier design text said *Content manager*). Folder setup, copies and in-place updates of snapshots/exports all work with Contributor.
- **Scopes:** `files.copy` accepts `drive` or `drive.file`. `drive.file` only covers files the app created or the user opened with the app, so it cannot read a delegate's Doc. Reading arbitrary link-shared Docs requires **`https://www.googleapis.com/auth/drive`** (Google classifies `drive`/`drive.readonly` as *restricted*; verification applies to public OAuth apps, not service accounts or internal apps). Least privilege is enforced by **what the identity can reach** (link-shared Docs and the DCMUN Shared Drive at Contributor) rather than by scope.
- Use `supportsAllDrives=true` on every call; store the returned file ids; tag created files with `appProperties` for reconciliation (see GOOGLE_DRIVE_ARCHITECTURE.md §12).

## 8. Failure behaviour

Conference OS never pretends access exists. Supabase state is independent: a Drive failure never changes the document state machine.

| Case | Delegate form | Chair | Future automation (Approval copy) |
| --- | --- | --- | --- |
| Doc set to Viewer/Commenter | Accepted (cannot be checked) | Can view, not edit → *Can't access* → "Ask the delegation to set Anyone with the link → **Editor**, or share with you as Editor" | Copy may still work (reader can copy unless the owner disabled copying) → **Synced**; else **Needs attention** |
| Doc still Restricted | Accepted | Request-access screen → *Can't access* | 403/404 → retry → **Needs attention: "Conference OS can't open this Doc. Ask the delegation to set Anyone with the link → Editor."** |
| School blocks Anyone-with-link | Delegate follows the direct-share fallback or uploads a file | Works for the Chair shared with | No access → **Needs attention**; Chair makes the Approval copy manually |
| Shared to one Chair only | — | That Chair can edit; others ask them | No access → **Needs attention** (manual copy) |
| Wrong Chair email | — | Nobody can open → *Can't access* | No access → **Needs attention** |
| Permission revoked / changed later | — | Opening fails → *Can't access* | Already-made copy is DCMUN-owned and unaffected; a not-yet-made copy → **Needs attention** |
| Doc deleted | — | "File not found" → *Can't access* | 404 → **Needs attention: "The delegation's document no longer exists."** The Approval copy, if made, survives. |
| External sharing prohibited | File-upload fallback | — | — |
| Drive API unavailable / 5xx / timeout | — | — | **Failed — will retry** with backoff; reconcile by `appProperties` before re-copying |
| Quota / rate limit (403/429 `rateLimitExceeded`, `userRateLimitExceeded`) | — | — | **Failed — will retry** (exponential backoff with jitter) |
| Shared Drive membership/role wrong | — | — | **Needs attention: "Conference OS can't write to the DCMUN Shared Drive. Check its membership (Contributor)."** System health Drive row YELLOW |
| Credential problem (WIF misconfigured, key revoked, token expired) | — | — | All jobs **Failed — will retry**; System health Drive row YELLOW "Drive connection problem"; never RED |
| Approval copy fails permanently | — | Chair copies manually and pastes the link (existing field) — manual wins | Job closed as superseded |

## 9. Recommendation

- **Preferred: A — one Conference OS service account**, used only server-side through **Vercel OIDC → Google Workload Identity Federation** (keyless). Add it as a **Contributor** member of the DCMUN Shared Drive. Scope: `drive`. No domain-wide delegation. It reads Docs set to "Anyone with the link" and writes only inside the Shared Drive.
- **Fallback: B — one dedicated DCMUN Workspace automation user** (licensed, strong password and 2-Step Verification, used by no human). Credentials are an internal OAuth app refresh token, server-only. Use B if DCMUN's Workspace policy refuses a service account as a Shared Drive member, or if no Google Cloud project can be set up.
- **Always available:** D — Chairs copy into the Approval folder manually and paste the link (current behaviour). Automation failures fall back to this.
- **Not recommended:** C — domain-wide delegation. Its only benefit (reaching Docs shared to individual DCMUN Chairs) does not justify power over every DCMUN account.

## 10. Security

- No Google OAuth for delegates or Chairs; no client-side Google credentials; nothing Google-related in `NEXT_PUBLIC_*`.
- Automation credentials are server-only: WIF (no stored secret) preferred; otherwise a **Sensitive** Vercel variable. Routes that trigger Drive work require a staff session with the right grant, or `CRON_SECRET`.
- The automation identity's reach is limited to what is link-shared with "anyone" plus the DCMUN Shared Drive (Contributor; cannot delete or move).
- Never store raw URLs from delegates; keep validated ids (plus a validated resource key if adopted, S-4).
- Chair names/emails shown on the public form are a deliberate disclosure. Show only Chairs assigned to that committee, and only their conference contact addresses.

## 11. Submission security review (current implementation, PRs #3–#5)

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

## 12. Admin setup checklist (future — do not create anything yet)

1. Identify or create the conference **Shared Drive** in the DCMUN Google Workspace. Record its id.
2. In a Google Cloud project owned by DCMUN, **enable the Google Drive API**.
3. Create the automation identity: **service account** (preferred) with Vercel OIDC → Workload Identity Federation, or the **Workspace automation user** (fallback).
4. Add it to the Shared Drive as **Contributor**. If DCMUN policy refuses the service account, switch to the fallback. Record the outcome.
5. Make sure every committee's Chair records have current names and emails (after S-2).
6. Open each committee's public submission page; verify it shows the assigned Chairs correctly and nothing else.
7. Test "Anyone with the link → Editor" from a **personal Gmail** Doc: a Chair can edit; the automation can read it.
8. Test from **another school's Workspace** account: same checks; record which schools restrict sharing.
9. Test a school account where **public-link editing is prohibited**: the delegate sees the option is unavailable and follows the direct-share fallback or the file upload.
10. Test the **direct share to one Chair**: that Chair can edit; the automation correctly reports *Needs attention*.
11. Test **automation access separately** from human access (a Doc a Chair can open is not necessarily one the automation can).
12. Test **copy into the Shared Drive**: the copy appears in the right committee's *Approval Copies*, owned by DCMUN, and a retry creates no second copy.
13. Test **source permission revocation** after copying: the copy survives; a pending copy turns *Needs attention*.
14. Record stable **folder and file ids** (root, committees, per-committee folders) in Conference OS; never rely on names.

## 13. CODEX REVIEW REQUIRED — DESIGN ONLY

- ~~Chair contacts (S-2)~~ — done in #7.
- **Resource key (S-4):** one nullable text column next to the stored Doc id (Claude's `resolution_links` / `resolution_submissions`), validated and appended to rebuilt URLs.
- **Drive folder mapping and jobs:** unchanged from GOOGLE_DRIVE_ARCHITECTURE.md §17, except the identity (above) and the Contributor role.

## Sources

- Google Drive API — Share files, folders and drives (permission types, `allowFileDiscovery`, Shared Drive roles): https://developers.google.com/workspace/drive/api/guides/manage-sharing
- Google Drive API — Access link-shared files using resource keys: https://developers.google.com/workspace/drive/api/guides/resource-keys
- Google Drive API — Shared drives overview ("Service accounts don't have storage quota and can't own files… must upload … into shared drives"; ownership by the organisation; roles): https://developers.google.com/workspace/drive/api/guides/about-shareddrives
- Google Drive API — Choose scopes (`drive.file` non-sensitive; `drive`, `drive.readonly` restricted): https://developers.google.com/workspace/drive/api/guides/about-auth
- Google Drive API — `files.copy` (accepted scopes, `supportsAllDrives`): https://developers.google.com/workspace/drive/api/reference/rest/v3/files/copy
- Google Drive API — Files resource (`copyRequiresWriterPermission`, `capabilities.canCopy`, `resourceKey`, `appProperties`): https://developers.google.com/workspace/drive/api/reference/rest/v3/files
- Google Workspace Admin — Manage external sharing for your organization (sharing outside the organisation, service accounts flagged in access warnings): https://knowledge.workspace.google.com/admin/drive/manage-external-sharing-for-your-organization
- Google Workspace Admin — Allow external sharing with only trusted domains ("Google service accounts (*.gserviceaccount.com) can't be used as trusted domains"): https://knowledge.workspace.google.com/admin/domains/allow-external-sharing-with-only-trusted-domains
- Google Workspace Learning Center — How file access works in shared drives (Contributor vs Content manager): https://support.google.com/a/users/answer/12380484
- Google Workspace Updates — 2021 link security update (resource keys): https://workspaceupdates.googleblog.com/2021/06/drive-file-link-updates.html
- Vercel — Connect to Google Cloud Platform with OIDC (Workload Identity Federation, service-account impersonation): https://vercel.com/docs/oidc/gcp

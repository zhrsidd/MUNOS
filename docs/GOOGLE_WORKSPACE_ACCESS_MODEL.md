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

## 4. School Workspace restrictions — expected behaviour

| Delegate's account | "Anyone with the link → Editor" available? | Direct share to a Chair's Gmail/other domain? |
| --- | --- | --- |
| Personal Gmail | Yes | Yes |
| DCMUN Workspace | As DCMUN policy allows | As policy allows |
| Other school, external sharing ON | Usually yes (admin may still disable public links) | Yes |
| Other school, link sharing limited to the school | **No** (only "People in <school> with the link") | Possibly, if external sharing to named users is on |
| Other school, external sharing OFF or allowlisted domains | **No** | **No** (unless DCMUN's domain is allowlisted) |

For the last two rows, the delegate's options are: (1) share directly with a Chair if allowed, (2) **upload a PDF/Word file** (the existing fallback), or (3) copy the text into a personal Google account's Doc if school rules permit. The form already offers (2).

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

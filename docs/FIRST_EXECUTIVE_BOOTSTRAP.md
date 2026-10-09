# First Executive on a new project — one-time bootstrap

**Who:** the technical lead (database access to the target Supabase project) and the person who will be the first Executive, together. **When:** once per new conference project (Production setup, release checklist section 2). **Time:** 10 minutes.

## Why this is needed

Staff access codes are issued in the app by an Executive (Executive → **Access codes**). A brand-new project has no Executive, so the first one cannot be issued from the app. The bootstrap creates **one short-lived Executive access code directly in the database**. It uses exactly the format, hashing and table that the app's own code management uses. Everything after that goes through the normal app:

- no second authentication system;
- no hand-inserted `user_access` grants;
- no schema change.

## What the script guarantees

[`scripts/bootstrap-first-executive.sql`](../scripts/bootstrap-first-executive.sql):

- **Explicit inputs:** the conference UUID; the role is `admin` (Executive); the committee is NULL.
- **Validity:** explicit and short (10 minutes to 24 hours; 2 hours suggested).
- **Generation:** 24 hexadecimal characters from database randomness, shown as six groups of four (`XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`).
- **Storage:** only the SHA-256 digest is written to `private.access_credentials`. `created_by` stays NULL, because no Executive identity exists yet.
- **The raw code is shown once**, in the script's last result row. It is held only in a transaction-local setting that disappears at commit, and **nothing is written to `audit_log`**.
- **Refuses to run** if the conference does not exist, if the validity is out of range, or if **any unrevoked Executive credential already exists** for that conference. It never replaces a code; the database's one-active-scope index enforces the same.

## Procedure

1. **Technical lead — check the project.** Supabase dashboard → the **intended** project (Production for the conference) → SQL Editor. Check the project name at the top.
2. **Technical lead — create the bootstrap code.**
   - Paste the whole of `scripts/bootstrap-first-executive.sql`.
   - Set **EDIT 1** to the conference UUID (the same value as Vercel's `NEXT_PUBLIC_CONFERENCE_ID` for that environment).
   - Set **EDIT 2** to the validity (for example `2 hours`).
   - Run the **whole** script at once.
   - Read the code from the result row to the first Executive, or show it on the screen, in person.
   - Do not save the query result, take a screenshot, or paste the code anywhere.
3. **First Executive — redeem it in the normal app.** On their own device, in a normal browser window: open the conference URL → **Enter staff access code** → type the code → **Open staff workspace**. This creates the device's normal anonymous identity and Executive grant. The Executive workspace opens.
4. **First Executive — issue the real Executive code.** Executive → **Access codes** → set **New code expires** (for example the end of the conference) → on the **Executive** row, **Rotate** → confirm → **Copy code** → store it in the password manager → **Done**.
   - Rotation **automatically revokes the bootstrap code**, so it can never authorize another device.
   - The device you are on keeps working.
5. **Technical lead — verify (section B of the script).** The bootstrap row (`created_by` empty) has `revoked_at` set. The new row's `created_by` is the first Executive's device.
6. **First Executive — before the bootstrap window ends:**
   - Prepare every other Executive device with the **new** code.
   - The bootstrap device's own access lasts only as long as the bootstrap code's validity, because a grant inherits its code's expiry. When that device shows **Conference access**, enter the new Executive code on it; it keeps the same device identity and its saved data. (This follows from the redemption design; it was not part of the 8 October test.)
7. From now on, **all** code management happens in Executive → Access codes.

If the bootstrap code is lost before it is used, revoke it with section C of the script and run the script again.

## Development test — 8 October 2026

Run on the development project `opmydpozhdgkpcnjwpqb`, test conference `cf99227f…`, through the `main` Preview `723147a` with fresh browser profiles. All steps passed.

| Step | Result |
| --- | --- |
| Refusals | Validity of 48 hours refused; unknown conference refused; a second run while the bootstrap code was active was refused ("An unrevoked Executive credential already exists…"). Nothing was inserted by any refused run. |
| 1. Create | One `admin` credential, committee NULL, `created_by` NULL, 2-hour expiry. |
| 2. Digest only | The stored value is 64 hexadecimal characters and equals SHA-256 of the code. Neither the code nor its digest appears in `audit_log`; no audit row was written; the transaction-local setting was gone afterwards. |
| 3. Redeem | A fresh device showed the gate and had no identity until the code was submitted. The normal gate then created an anonymous identity and an `admin` grant sourced from the bootstrap credential. |
| 4. Executive access | The Executive workspace and Access codes opened. |
| 5. Normal code | Rotate on the Executive row created a normal code (shown once). `created_by` = the bootstrapped device. |
| 6. Bootstrap retired | The bootstrap credential was revoked by that rotation, at the same instant. |
| 7. Old code refused | A second fresh device entering the bootstrap code got "That code is invalid or expired". |
| 8. Prepared device kept | The bootstrapped device still had the Executive workspace and System health after a reload. A third fresh device was admitted with the normal code. |

Regression test: `tests/bootstrap-first-executive.test.ts` runs the committed script against every migration in CI (digest only, no audit row, refusals, normal redemption, retirement by the first rotation, prepared device kept).

Afterwards, the test codes and the two test grants were revoked. Deletion of those rows is part of the development cleanup script held by the technical lead.

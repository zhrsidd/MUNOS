# Implementation plans: clear majority, Chair photos, configurable points and voting rule

Status: **documentation reviewed by Codex, 20 October 2026; owner decisions and independent-review conditions recorded below.** Merging this plan does not approve the feature implementations or apply their migrations. Implementation may proceed as draft PRs, so Codex can review each plan together with its code. No migration is applied and no protected change is merged until Codex has reviewed it and the owner approves. The owner briefs are [CLEAR_MAJORITY_VOTING.md](../CLEAR_MAJORITY_VOTING.md) and [UI_PRIORITY_PASS.md](../UI_PRIORITY_PASS.md) (the "Pending" rows) and, for photos, [OPERATIONS_EXTENSIONS.md](../OPERATIONS_EXTENSIONS.md#school-group-photos-and-chair-reminders).

All four plans follow the same rules:

* Each feature is a separate PR with its own additive migration. Migrations are never edited after they are applied.
* Function bodies change through `pg_temp.patch_once` anchors, as in `20261009120000_procedure_usability`. A patch fails loudly if its anchor does not match exactly once.
* Every write goes through the existing outbox and a server-validated command. There is no local-only state that looks saved.
* The local demo backend (`lib/`) and SQL must agree. Each plan ends with a client/PostgreSQL parity test, like `tests/voting-rules.test.ts`.
* Existing data keeps its meaning: no backfill rewrites stored points, ballots or outcomes.

---

## 1. Clear majority For / Against

### Current implementation

* Outcome rule:
  * Client: `lib/commands.ts` `votingOutcome`.
  * Server: `private.apply_mutation`, the `document` → `Closed` branch (latest body from `20261006135232_nonretryable_stale_conflicts`).
  * Abstentions are excluded and a tie fails. Two-thirds is inclusive. The committee `voting_rule` overrides the conference rule.
  * A veto from a present P5 member voting Against fails the resolution (`private.veto_delegates`).
  * Covered by `tests/procedure.test.ts` and `tests/voting-rules.test.ts`.
* Closing requires **every non-absent delegate to have a ballot** ("Record every eligible ballot before closing"). The submitted outcome must also equal the counted result.
* There is no way to close a normal vote without named ballots, which is what the owner wants to avoid for obvious results.
* `voteMode` (normal/divide) deletes the ballots recorded so far. Their history survives only in `audit_log`.

### Proposed change (minimal)

Close the resolution with a declared result instead of counted ballots. No new tables are needed.

**Database (one migration):**

* `documents`:
  * add `"outcomeMethod" text not null default 'counted' check ("outcomeMethod" in ('counted','observed'))`;
  * add `"declaredBy" uuid null` and `"declaredAt" timestamptz null`.
* Existing rows become `counted` and change meaning in no way. The snapshot already serialises every document column.
* `document` → `Closed` branch, when `command->>'method' = 'observed'`:
  * require `status = 'In Debate'`, the Chair role and the same committee scope (unchanged);
  * require `"voteMode"` not to be `divide`, and the effective rule to be `simple_majority`;
  * **refuse when the committee has `vetoEnabled` and the vote is substantive.** Missing ballots cannot establish that no veto was cast, so counted voting is required there;
  * require `outcome` to be `Passed` or `Failed`, then store `outcome`, `"outcomeMethod"='observed'`, `"declaredBy"=actor` and `"declaredAt"=client_time`;
  * retain a nonzero eligible-attendance requirement; skip only named-ballot completeness and the counted-rule comparison;
  * reject a mismatched ballot/session context; the UI action and confirmation must retain the same session safeguard as counted voting;
  * require `command->>'ballotRevision'` to equal the document's current `revision` (PT409 otherwise): the declaration is bound to the ballot revision the Chair opened it on, so a restart from any Chair device invalidates it;
  * leave any ballots recorded earlier untouched: not deleted and not counted;
  * `"vetoedBy"` stays empty.
* The `method` key is optional, and an absent key keeps today's counted path byte for byte.

**App:**

* `lib/commands.ts`: the `document` command gains an optional `method?: 'observed'`. The local handler mirrors the SQL rules. `votingOutcome` is unchanged and is used only for counted closes.
* `components/voting-console.tsx`: add two compact buttons, **Clear majority For** and **Clear majority Against**.
  * Show them only for a normal vote under simple majority, and not on a veto-enabled substantive vote. Otherwise show one line explaining why counted voting is required.
  * The confirmation names the resolution and says "Observed majority: no country votes or totals will be recorded". If ballots are already recorded, it adds "N recorded ballots are kept but not counted".
* Display: wherever an outcome chip shows (`documents.tsx`, `executive-resolution-overview.tsx`, the Chair outcome modal), observed results read "Passed · observed majority" with no counts.
  * The metrics row shows "Not recorded", never `0`.
  * The outcome history shows the declaring Chair and the time.

### Edge cases

| Case | Behaviour |
| --- | --- |
| Two-thirds committee, Divide the House, veto-enabled substantive vote | Shortcut hidden; the server refuses `method:'observed'` |
| Some ballots already recorded | Allowed after the extra confirmation line; ballots are kept and not counted, and the audit log records the observed close |
| Two Chairs: one closes counted, the other observed | The document revision check makes the second a stale conflict, retained in the outbox, never a silent overwrite |
| Offline | Queued like any close; on reconnect a stale revision becomes a visible conflict |
| Duplicate submission | Same mutation id: an idempotent receipt; different id: refused because the resolution is already Closed |
| Revoked grant or other committee | Refused by the existing `has_access` and committee checks |
| Procedural vote | Allowed (no veto applies), under simple majority only |
| Re-opening a vote | Out of scope: Closed is final today and stays final |

### Acceptance tests

1. Client and PostgreSQL: an observed For closes Passed and an observed Against closes Failed. Both store `observed`, `declaredBy` and `declaredAt`, and create no votes rows.
2. Both refuse observed under two-thirds, in Divide the House, and on a veto-enabled substantive vote. Counted voting still works in each.
3. Ballots recorded before an observed close are unchanged afterwards.
4. Every existing counted, abstention, Divide the House and veto test still passes, and the counted path is unchanged when `method` is absent.
5. Stale revision, duplicate mutation id, a Chair from another committee and a revoked grant: each is refused or replayed correctly.
6. UI: observed results never show `0` counts. The result survives reload and an offline queue and replay.

### Owner decisions

Decided by the owner, 20 October:

* The shortcut is available on **procedural** votes as well as substantive non-veto votes.
* With ballots already recorded, an observed close is **allowed with a warning**; the earlier ballots are kept and not counted.

---

## 2. Chairs included in their school's group photo

### Current implementation

* Photo slots are per school (`public.photo_slots.school_id`). Acknowledgements are per committee, stage and slot revision.
* Delegates only:
  * `lib/operations/photo-reminders.ts` `committeePhotoReminders` lists a committee's delegates from the slot's school and drops a slot when there are none;
  * `affectedCommittees` counts delegates;
  * SQL notification targeting, `private.committees_for_schools` (`20261006023106_photo_schedule`), also uses delegates only.
* Staff have no school:
  * `public.staff(id, conference_id, name, auth_user_id, email, contactRevision)`;
  * roles come from `conference_staff`, and committee assignment from `committee_staff`.

### Proposed change

**Database (one migration):**

* `staff`: add `school_id uuid null`, with `foreign key (school_id, conference_id) references public.schools(id, conference_id)`. Null means no school, which is today's behaviour.
* Extend the Executive staff command (or the staff batch command; whichever owns staff edits after `staff_schedule_amendments`) to set or clear `schoolId`:
  * revision-checked like `staffContact`;
  * Executive only;
  * the school must belong to the conference.
* Snapshot: add `schoolId` to the staff projection. A school is not sensitive. Codex should confirm which roles can read the staff projection today, so this adds no new reader.
* `private.committees_for_schools`: also return committees that have a **Chair** (`conference_staff.role='chair'` joined to `committee_staff`) whose `staff.school_id` is in the schools. Realtime then notifies those committees too.

**App:**

* `lib/domain.ts`: add `Staff.schoolId?: string | null`.
* `committeePhotoReminders`:
  * also collect `chairs`: staff with role `chair`, assigned to this committee, with `schoolId === slot.schoolId`;
  * keep a slot when it has delegates **or** Chairs.
* `affectedCommittees`: return `{delegates, chairs}` for each committee.
* Chair banner and `/chair/photos`: "2 delegates and Chair A. Name should attend". The reminder stages and the "Delegates sent" acknowledgement are unchanged. One acknowledgement still covers the committee.
* Executive → Group photos:
  * shows "GA1 · 2 delegates + 1 Chair";
  * when **every** Chair assigned to a committee belongs to the same slot's school, shows a non-blocking notice: "GA1 has no Chair outside this photo". This follows the staffing note in `UI_PRIORITY_PASS.md`: organisers arrange cover; the software does not enforce it.
* Executive → Chairs & staff: a school picker per Chair, and an optional `school` column in staff CSV import, matched with the existing school-name normaliser in `lib/operations/photo-import.ts`.

### Edge cases

| Case | Behaviour |
| --- | --- |
| Chair assigned to two committees | Listed in both committees' reminders |
| Chair's school or committee/role assignment changes after acknowledgements | Version the affected participant list or advance the relevant slot revision so old acknowledgements no longer silence the changed reminder; preserve history and refuse stale queued acknowledgements for the current version |
| Chair with no school | Unchanged from today |
| A committee has Chairs but no delegates from the school | The slot now appears for it (previously hidden) |
| Cancelled slot | Same cancelled banner rules, now also for Chair-only committees |
| Staff with only Approval or Logistics roles | Not included (proposal: Chairs only) |
| Offline Chair device | Reminders are derived from the cached snapshot, as now |

### Acceptance tests

1. Client and PostgreSQL: setting a Chair's school is Executive-only, revision-checked and conference-scoped. A school from another conference is refused by the FK.
2. `committeePhotoReminders` includes the matching Chair and keeps a slot for a committee with a Chair but no delegates. A Chair from another school or committee is not listed.
3. `committees_for_schools` returns Chair-only committees, so the Realtime topic targeting test in `photo-db.test.ts` is extended.
4. The "no Chair outside this photo" notice appears only when all of a committee's Chairs share the slot's school.
5. Existing `photo-reminders` and `photo-db` tests pass unchanged.

### Owner decisions

Decided by the owner, 20 October:

* School photos include **all delegates and Chairs with a school**. Approval, Logistics and Executive staff are not included.
* A **non-blocking Executive notice** is enough when every Chair of a committee would be at the same photo.

---

## 3. Configurable Main Submitter and Debated Amendment points

### Current implementation

**Definitions (`lib/scoring.ts`):**

* `MAIN_SUBMITTER_POINTS = 5`;
* `REQUIRED_SCORING` holds speech `[1,2,3]`, POI `[1,2]` and submitter `[5]`;
* `isConfigurableScoring` excludes `submitter`;
* `scoringProblem` refuses submitter changes, and allows 1–10 unique values between 0 and 20 for the others.

**Main Submitter credit is +5, exactly once per resolution:**

* Automatic award:
  * client: `lib/procedure/commands.ts` `speechScore`;
  * SQL: the literal `'submitter',5` in `private.apply_procedure`.
* Manual award: the `participation` command with category `submitter`, checked once per resolution under the committee row lock.
* SQL validation:
  * `private.scoring_values` returns `array[5]` for `submitter`;
  * `private.scoring_problem` refuses configuring it.

**Amendment category:**

* Not required: it exists only in seed data (`amendment [3]`). A blank conference therefore has no amendment category, and `private.required_scoring_label` returns null for it.
* Credit is awarded manually by the Chair. Passing an amendment creates no event (`docs/PARTICIPATION_VIEWS.md`).

**Events and corrections:**

* Events store their points, so history is already preserved.
* Corrections (the `event` command) re-validate the category against the **current** values.

### Proposed change

**Main Submitter:**

* Make it configurable as **exactly one value from 1 to 20**, at conference level and as a committee override, like the other categories.
* The +5 default stays when no definition exists.
* The exactly-once rule is unchanged.

**Debated Amendment:**

* Make `amendment` a required category labelled "Debated amendment", default `[3]`, configurable like speech and POI.
* Awarding stays manual. No automatic credit on debate or passage.

**Database (one migration, function patches only; no table change):**

* `private.required_scoring_label`: add `'submitter' → 'Main Submitter'` and `'amendment' → 'Debated amendment'`.
* `private.scoring_values`:
  * for `submitter`, use the definition (committee override, then conference) and fall back to `array[5]`;
  * for `amendment`, use the definition and fall back to `array[3]`.
* `private.scoring_problem`:
  * `submitter` must be one integer from 1 to 20;
  * other categories keep their current rules.
* `private.apply_procedure` `speechScore`: replace the literal `5` with `(private.scoring_values(conf,cid,'submitter'))[1]`.
* `event` correction: preserve historical stored values and allow undo regardless of today's configuration. The existing command changes points or undoes; it has no metadata-only correction. A no-op same-points correction is not a required contract change.

**App:**

* `lib/scoring.ts`:
  * remove the `submitter` exception from `isConfigurableScoring`;
  * add `amendment` to `REQUIRED_SCORING`;
  * apply the one-value rule in `scoringProblem`;
  * `MAIN_SUBMITTER_POINTS` becomes the default only.
* `speechScore` (client) reads `effectiveScoring(d, committeeId)` for the submitter value.
* `components/admin.tsx` `ScoringSettings`:
  * Main Submitter gets an editable single-value field with "Applies to new credits; earlier credits keep their points";
  * this replaces the read-only row added in [zhrsidd/MUNOS#32](https://github.com/zhrsidd/MUNOS/pull/32).

### Edge cases

| Case | Behaviour |
| --- | --- |
| Value changed mid-conference | New credits use the new value; stored events keep theirs; leaderboards sum stored points |
| Committee override for Main Submitter | Allowed; that committee uses it, others inherit |
| Main Submitter set to several values or 0 | Refused (one value, 1–20) |
| Speech already scored, value changed before the next resolution | Exactly-once is per resolution; the next resolution uses the new value |
| Offline device with an old snapshot | Capture and validate the effective submitter scoring setting in the queued command; retain a visible conflict if it changed. Processing-time scoring is an alternative only with explicit owner acceptance and truthful provisional/repriced UI, not silent replay repricing |
| Conference created before this migration without an `amendment` row | Falls back to `[3]` until the Executive saves a value |

### Acceptance tests

1. Client and PostgreSQL: configuring Main Submitter `[4]` makes the next Main Submitter speech award +4, still once per resolution. `[4,5]`, `[0]` and `[21]` are refused.
2. Events stored at +5 before the change are unchanged. Undoing one still succeeds after configuration changes; new point changes obey the current contract. Test a queued automatic award against a later configuration change.
3. A committee override applies only to that committee.
4. On a blank conference, `amendment` can be configured, and the default `[3]` applies before that.
5. Existing `procedure-usability*` and `participation-view` tests pass. The test that asserts "cannot be configured" is updated to the new contract in the same PR.

### Owner decisions

Decided by the owner, 20 October:

* Main Submitter is **one value from 1 to 20** (default +5).
* Debated amendment credit **stays manual**.

---

## 4. Voting-rule setting (added 20 October)

The owner agreed to an Executive setting for the voting rule. Today `voting_rule` exists on conferences and committees and both backends honour it (`tests/voting-rules.test.ts`), but no screen or command sets it.

* **App:** in Executive → Conference, add a "Voting rule" select (Simple majority / Two-thirds). In Executive → Committees, add a per-committee override with "Use conference rule" as the default.
* **Commands:** add `votingRule` to the existing `conference` command and to the `committeeUpdate` batch command. A committee's value may be null, meaning inherit.
* **Database:** patch the `conference` branch of `private.apply_mutation` and the `committeeUpdate` branch of `private.apply_staff_batch` to write `voting_rule`, which keeps its existing CHECK constraint. No table change is needed.
* **Edge cases:**
  * Changing the rule while a vote is open takes effect when it closes. Closing recomputes from the current rule, as it does today, so the Voting panel must show the rule in force.
  * Resolutions that are already closed keep their stored outcome.
* **Acceptance tests:**
  * Client and PostgreSQL: only the Executive can set the rule, and a committee null value inherits the conference rule.
  * The next close uses the new rule.
  * Closed outcomes are unchanged.

## Order and review

1. **Configurable points** first. It changes functions only, adds no table columns, and has the smallest surface.
2. **Chairs in photos.** Adds one nullable column and changes notification targeting.
3. **Clear majority.** Changes the vote-closing contract, so it gets the most careful review and a staging replay.
4. **Voting-rule setting.** Small, and can follow clear majority, or come earlier if DCMUN needs two-thirds for any committee.

For each one, the sequence is:

1. A PR with code, migration and tests.
2. Codex review.
3. Owner approval.
4. The owner applies the migration with the Supabase CLI to the DCMUN project.
5. Read-only verification, then `npm run smoke:project`.

Nothing is merged or applied without that approval.

## Independent implementation review conditions · 20 October 2026

Codex reviewed the implementation PR heads separately from this plan. The plan may be merged as documentation; **PRs #35, #36 and #37 remain unapproved until their findings are resolved**. A clean Git merge or green existing CI does not supersede these conditions.

- **Points (#35):** cover the previously reproduced optimistic +5 → server +7 replay without a configuration precondition. Resolve the offline contract above and test the selected policy. Historical points and exactly-once behavior remain required.
- **Photos (#36):** test an already-acknowledged delegate committee gaining a Chair from the same school, affiliation clearing/change, assignment/role changes, and stale offline acknowledgements. Updating the participant display without invalidating the acknowledgement is insufficient.
- **Observed voting (#37):** refuse no-attendance/all-absent closes in client and SQL; guard a session switch before confirmation; retain old ballots honestly; show the declaring Chair/time in history. Make the observed-result CHECK explicitly reject a NULL outcome (the RPC's Passed/Failed validation alone does not make the CHECK enforce this).
- **Integration:** review the revised exact heads, replay the combined migration sequence in isolation and rerun the relevant parity/authorization/offline tests. The owner has authorized Codex to merge changes that pass review; that authorization does not authorize applying hosted migrations, changing conference records or releasing Production.

No new local runtime verification was available during this documentation reconciliation. Exact-head CI and source review are the current evidence; earlier independent reproductions remain applicable where implementation code is unchanged.

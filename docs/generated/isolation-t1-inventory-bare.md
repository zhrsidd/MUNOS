# T1 privilege inventory (GENERATED, do not edit)

Generator: `scripts/isolation-inventory/inventory.mts`. Baseline: **bare**. PostgreSQL 17, disposable local database replayed from empty.
Migrations replayed: 27 files, combined SHA-256 `ba870aa1059d8871`. Output is deterministic (no timestamps); a diff means the schema, grants or generator changed.

**Bare baseline.** The three-role bootstrap the existing PostgreSQL tests use: no default privileges. Shown only to quantify how much exposure comes from the hosted default-privilege model.

Scope: functions and relations in schemas `public` and `private` (the only schemas the migrations create or own), policies on those schemas plus `storage.objects`. Extension and Supabase-internal objects are excluded.

## Roles and schemas

| Role | superuser | login | inherit | bypassrls | member of |
| --- | --- | --- | --- | --- | --- |
| anon | false | false | true | false | - |
| authenticated | false | false | true | false | - |
| authenticator | false | true | false | false | anon,authenticated,service_role |
| postgres | true | true | true | true | anon,authenticated,service_role |
| service_role | false | false | true | false | - |
| supabase_admin | true | true | true | false | - |

Custom roles created by the migrations or the bootstrap beyond the list above: gw_owner, lifecycle_operator, lifecycle_owner, proto_agent, proto_nobody.

| Schema | owner | USAGE: anon / authenticated / service_role / authenticator / postgres | CREATE: anon / authenticated / service_role / authenticator / postgres |
| --- | --- | --- | --- |
| auth | postgres | - Y - - Y | - - - - Y |
| private | postgres | - Y - - Y | - - - - Y |
| public | pg_database_owner | Y Y Y Y Y | - - - - Y |

`authenticator` is `NOINHERIT` and holds `anon`, `authenticated`, `service_role`: PostgREST connects as it and switches role per request, so only the three Data API roles matter for HTTP callers.

## Default privileges (pg_default_acl)

None. New objects get only the PostgreSQL defaults (owner full, functions executable by PUBLIC).

PostgreSQL grants `EXECUTE` to `PUBLIC` on every new function unless a default privilege revokes it. `PUBLIC` is therefore listed separately below.

## Assumption A13 probe (re-grant risk for new, replaced and recreated functions)

Executed in the disposable database after the inventory was read:

- 1. new function created by the migration owner, nothing revoked: PUBLIC=yes anon=yes authenticated=yes service_role=yes
- 2. after explicit REVOKE EXECUTE from PUBLIC, anon, authenticated, service_role: PUBLIC=no anon=no authenticated=no service_role=no
- 3. after CREATE OR REPLACE (a later migration that redefines the body): PUBLIC=no anon=no authenticated=no service_role=no
- 4. after DROP FUNCTION + CREATE FUNCTION (a later migration that recreates it): PUBLIC=yes anon=yes authenticated=yes service_role=yes
- 5. new overload a13_probe(int) next to the revoked one: anon=yes authenticated=yes service_role=yes

## Functions

56 functions (49 callable, 7 trigger functions). Writes column is a **textual heuristic** over the function body and its named callees (insert/update/delete/truncate/merge/nextval); it can miss dynamic SQL and can over-report.

| Function | Kind | Security | Owner | Volatility | Config (search_path) | EXECUTE held by | Data API callers (EXECUTE + schema USAGE) | Writes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `private.access_grants()` | function | definer | postgres | stable | search_path="" | authenticated, postgres | authenticated | reads/none |
| `private.advance_photo_epoch(conf uuid, committees uuid[], schools uuid[])` | function | definer | postgres | volatile | search_path="" | postgres | - | writes |
| `private.apply_mutation(conf uuid, mutation uuid, command jsonb, requested_role conference_role, expected text,...)` | function | definer | postgres | volatile | search_path="" | authenticated, postgres | authenticated | writes |
| `private.apply_operations_mutation(conf uuid, mutation uuid, command jsonb, requested_role conference_role, expected text,...)` | function | definer | postgres | volatile | search_path="" | authenticated, postgres | authenticated | writes |
| `private.apply_procedure(conf uuid, mutation uuid, command jsonb, requested_role conference_role, expected text,...)` | function | definer | postgres | volatile | search_path="" | authenticated, postgres | authenticated | writes |
| `private.apply_staff_batch(conf uuid, mutation uuid, command jsonb, requested_role conference_role, expected text,...)` | function | definer | postgres | volatile | search_path="" | authenticated, postgres | authenticated | writes |
| `private.batch_has_references(target regclass, target_id uuid, ignored regclass[])` | function | invoker | postgres | volatile | search_path="" | postgres | - | reads/none |
| `private.batch_session_used(sid uuid)` | function | invoker | postgres | volatile | search_path="" | postgres | - | reads/none |
| `private.committees_for_schools(schools uuid[])` | function | invoker | postgres | stable | search_path="" | postgres | - | reads/none |
| `private.decision_history(conf uuid)` | function | definer | postgres | stable | search_path="" | authenticated, postgres | authenticated | reads/none |
| `private.document_round()` (trigger) | function | invoker | postgres | volatile | search_path="" | postgres | n/a | reads/none |
| `private.document_submitter_countries(conf uuid)` | function | definer | postgres | stable | search_path="" | authenticated, postgres | authenticated | reads/none |
| `private.has_access(conf uuid, committee uuid, roles conference_role[])` | function | definer | postgres | stable | search_path="" | authenticated, postgres | authenticated | reads/none |
| `private.link_decision_comment()` (trigger) | function | definer | postgres | volatile | search_path="" | postgres | n/a | writes |
| `private.materialize_new_committee_slots()` (trigger) | function | invoker | postgres | volatile | search_path="" | postgres | n/a | writes |
| `private.next_resolution_code(conf uuid, committee uuid)` | function | definer | postgres | volatile | search_path="" | postgres | - | reads/none |
| `private.ops_photo_ack(conf uuid, cid uuid, actor uuid, command jsonb)` | function | invoker | postgres | volatile | search_path="" | postgres | - | writes |
| `private.ops_photo_import(conf uuid, mutation uuid, command jsonb)` | function | invoker | postgres | volatile | search_path="" | postgres | - | writes |
| `private.ops_photo_slot(conf uuid, new_id uuid, command jsonb)` | function | invoker | postgres | volatile | search_path="" | postgres | - | writes |
| `private.ops_point_adjustment(conf uuid, cid uuid, actor uuid, new_id uuid, command jsonb)` | function | definer | postgres | volatile | search_path="" | postgres | - | writes |
| `private.ops_resolution_link(conf uuid, cid uuid, command jsonb)` | function | invoker | postgres | volatile | search_path="" | postgres | - | writes |
| `private.ops_session_import(conf uuid, mutation uuid, command jsonb)` | function | invoker | postgres | volatile | search_path="" | postgres | - | writes |
| `private.ops_staff_school(conf uuid, command jsonb)` | function | invoker | postgres | volatile | search_path="" | postgres | - | writes |
| `private.ops_submission_link(conf uuid, cid uuid, actor uuid, new_id uuid, command jsonb)` | function | invoker | postgres | volatile | search_path="" | postgres | - | writes |
| `private.permitted(grants jsonb, conf uuid, committee uuid, roles conference_role[])` | function | invoker | postgres | immutable | search_path="" | authenticated, postgres | authenticated | reads/none |
| `private.photo_chairs(conf uuid)` | function | definer | postgres | stable | search_path="" | authenticated, postgres | authenticated | reads/none |
| `private.photo_epoch_chair(conf uuid, member uuid, committees uuid[])` | function | definer | postgres | volatile | search_path="" | postgres | - | writes (via callee) |
| `private.photo_epoch_trigger()` (trigger) | function | definer | postgres | volatile | search_path="" | postgres | n/a | writes (via callee) |
| `private.print_copies(conf uuid, cid uuid)` | function | definer | postgres | stable | search_path="" | postgres | - | reads/none |
| `private.record_document_decision()` (trigger) | function | definer | postgres | volatile | search_path="" | postgres | n/a | writes |
| `private.reject_archived_chair_credential()` (trigger) | function | invoker | postgres | volatile | search_path="" | postgres | n/a | reads/none |
| `private.require_operational_session(conf uuid, sid uuid)` | function | invoker | postgres | volatile | search_path="" | postgres | - | reads/none |
| `private.required_scoring_label(category text)` | function | invoker | postgres | immutable | search_path="" | postgres | - | reads/none |
| `private.scoring_problem(category text, vals integer[])` | function | invoker | postgres | immutable | search_path="" | postgres | - | reads/none |
| `private.scoring_values(conf uuid, cid uuid, category text)` | function | invoker | postgres | stable | search_path="" | postgres | - | reads/none |
| `private.set_print_copies()` (trigger) | function | definer | postgres | volatile | search_path="" | postgres | n/a | reads/none |
| `private.submitter_country(conf uuid, committee uuid, delegate uuid)` | function | definer | postgres | stable | search_path="" | postgres | - | reads/none |
| `private.uuid_or_null(value text)` | function | invoker | postgres | immutable | search_path="" | authenticated, postgres | authenticated | reads/none |
| `private.valid_flag(value text)` | function | invoker | postgres | immutable | search_path="" | postgres | - | reads/none |
| `private.veto_delegates(rid uuid)` | function | invoker | postgres | stable | search_path="" | postgres | - | reads/none |
| `public.access_code_status(conf uuid)` | function | definer | postgres | stable | search_path="" | authenticated, postgres | authenticated | reads/none |
| `public.amendment_link_info(link_token text)` | function | definer | postgres | stable | search_path="" | service_role, postgres | service_role | reads/none |
| `public.apply_conference_mutation(conf uuid, mutation uuid, command jsonb, requested_role conference_role, expected text,...)` | function | invoker | postgres | volatile | search_path="" | authenticated, postgres | authenticated | writes (via callee) |
| `public.apply_operations_mutation(conf uuid, mutation uuid, command jsonb, requested_role conference_role, expected text,...)` | function | invoker | postgres | volatile | search_path="" | authenticated, postgres | authenticated | writes (via callee) |
| `public.conference_snapshot(conf uuid)` | function | invoker | postgres | stable | search_path="" | authenticated, postgres | authenticated | reads/none |
| `public.conference_state_snapshot(conf uuid)` | function | invoker | postgres | stable | search_path="" | authenticated, postgres | authenticated | reads/none |
| `public.executive_snapshot(conf uuid)` | function | invoker | postgres | stable | search_path="" | authenticated, postgres | authenticated | reads/none |
| `public.executive_state_snapshot(conf uuid)` | function | invoker | postgres | stable | search_path="" | authenticated, postgres | authenticated | reads/none |
| `public.operations_snapshot(conf uuid)` | function | invoker | postgres | stable | search_path="" | authenticated, postgres | authenticated | reads/none |
| `public.redeem_access_code(conf uuid, code text)` | function | definer | postgres | volatile | search_path="" | authenticated, postgres | authenticated | writes |
| `public.revoke_access_code(conf uuid, credential uuid, revoke_devices boolean)` | function | definer | postgres | volatile | search_path="" | authenticated, postgres | authenticated | writes |
| `public.rotate_access_code(conf uuid, requested_role conference_role, committee uuid, expires_at timestamp with ti...)` | function | definer | postgres | volatile | search_path="" | authenticated, postgres | authenticated | writes |
| `public.staff_batch_snapshot(conf uuid, include_amendments boolean)` | function | invoker | postgres | stable | search_path="" | authenticated, postgres | authenticated | reads/none |
| `public.submission_link_info(link_token text)` | function | definer | postgres | stable | search_path="" | service_role, postgres | service_role | reads/none |
| `public.submit_amendment(link_token text, submission uuid, submitter uuid, resolution uuid, amendment_type text,...)` | function | definer | postgres | volatile | search_path="" | service_role, postgres | service_role | writes |
| `public.submit_resolution(link_token text, submission uuid, submitter uuid, title text, google_doc_id text, file_...)` | function | definer | postgres | volatile | search_path="" | service_role, postgres | service_role | writes |

## Flags

### Functions that write and can be called directly through the Data API (11)

Direct = `EXECUTE` and schema `USAGE` for at least one of anon / authenticated / service_role. Each of these is a direct-write surface that a gateway must close (ISOLATION_DESIGN 6.3).

| Function | Callable by | Security | Write type |
| --- | --- | --- | --- |
| `private.apply_mutation(conf uuid, mutation uuid, command jsonb, requested_role conference_role, expected text,...)` | authenticated | definer | direct DML |
| `private.apply_operations_mutation(conf uuid, mutation uuid, command jsonb, requested_role conference_role, expected text,...)` | authenticated | definer | direct DML |
| `private.apply_procedure(conf uuid, mutation uuid, command jsonb, requested_role conference_role, expected text,...)` | authenticated | definer | direct DML |
| `private.apply_staff_batch(conf uuid, mutation uuid, command jsonb, requested_role conference_role, expected text,...)` | authenticated | definer | direct DML |
| `public.apply_conference_mutation(conf uuid, mutation uuid, command jsonb, requested_role conference_role, expected text,...)` | authenticated | invoker | via callee |
| `public.apply_operations_mutation(conf uuid, mutation uuid, command jsonb, requested_role conference_role, expected text,...)` | authenticated | invoker | via callee |
| `public.redeem_access_code(conf uuid, code text)` | authenticated | definer | direct DML |
| `public.revoke_access_code(conf uuid, credential uuid, revoke_devices boolean)` | authenticated | definer | direct DML |
| `public.rotate_access_code(conf uuid, requested_role conference_role, committee uuid, expires_at timestamp with ti...)` | authenticated | definer | direct DML |
| `public.submit_amendment(link_token text, submission uuid, submitter uuid, resolution uuid, amendment_type text,...)` | service_role | definer | direct DML |
| `public.submit_resolution(link_token text, submission uuid, submitter uuid, title text, google_doc_id text, file_...)` | service_role | definer | direct DML |

### Writing functions with EXECUTE held by PUBLIC (0)

PUBLIC covers every role including any future one (and `anon`, subject to schema `USAGE`).

- none

### SECURITY DEFINER functions without a fixed search_path (0)

- none

### `private` functions callable by a Data API role (11)

`private` is not an exposed PostgREST schema (hosted exposure is assumption A3), so these are reachable only from SQL, policies and other functions, but the role privileges below are what a SQL-level caller would have.

- `private.access_grants()`: authenticated (reads/none)
- `private.apply_mutation(conf uuid, mutation uuid, command jsonb, requested_role conference_role, expected text,...)`: authenticated (writes)
- `private.apply_operations_mutation(conf uuid, mutation uuid, command jsonb, requested_role conference_role, expected text,...)`: authenticated (writes)
- `private.apply_procedure(conf uuid, mutation uuid, command jsonb, requested_role conference_role, expected text,...)`: authenticated (writes)
- `private.apply_staff_batch(conf uuid, mutation uuid, command jsonb, requested_role conference_role, expected text,...)`: authenticated (writes)
- `private.decision_history(conf uuid)`: authenticated (reads/none)
- `private.document_submitter_countries(conf uuid)`: authenticated (reads/none)
- `private.has_access(conf uuid, committee uuid, roles conference_role[])`: authenticated (reads/none)
- `private.permitted(grants jsonb, conf uuid, committee uuid, roles conference_role[])`: authenticated (reads/none)
- `private.photo_chairs(conf uuid)`: authenticated (reads/none)
- `private.uuid_or_null(value text)`: authenticated (reads/none)

## Tables, views and sequences

Privilege letters: r=SELECT a=INSERT w=UPDATE d=DELETE D=TRUNCATE x=REFERENCES t=TRIGGER; sequences: U=USAGE r=SELECT w=UPDATE. Effective privileges (including PUBLIC and role membership) from `has_table_privilege` / `has_sequence_privilege`.

| Relation | Kind | Owner | RLS | Forced | Options | anon | authenticated | service_role | authenticator | postgres |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `private.access_credentials` | table | postgres | yes | no | - | - | - | - | - | rawdDxt |
| `private.access_grant_sources` | table | postgres | yes | no | - | - | - | - | - | rawdDxt |
| `private.access_redemption_attempts` | table | postgres | yes | no | - | - | - | - | - | rawdDxt |
| `private.amendment_submissions` | table | postgres | yes | no | - | - | - | - | - | rawdDxt |
| `private.mutation_receipts` | table | postgres | yes | no | - | - | - | - | - | rawdDxt |
| `private.resolution_submissions` | table | postgres | yes | no | - | - | - | - | - | rawdDxt |
| `public.amendment_links` | table | postgres | yes | no | - | - | r | - | - | rawdDxt |
| `public.amendments` | table | postgres | yes | no | - | - | r | - | - | rawdDxt |
| `public.attendance` | table | postgres | yes | no | - | - | r | - | - | rawdDxt |
| `public.audit_log` | table | postgres | yes | no | - | - | r | - | - | rawdDxt |
| `public.award_criteria` | table | postgres | yes | no | - | - | r | - | - | rawdDxt |
| `public.award_scores` | table | postgres | yes | no | - | - | r | - | - | rawdDxt |
| `public.committee_staff` | table | postgres | yes | no | - | - | r | - | - | rawdDxt |
| `public.committees` | table | postgres | yes | no | - | - | r | - | - | rawdDxt |
| `public.conference_session_slots` | table | postgres | yes | no | - | - | r | - | - | rawdDxt |
| `public.conference_staff` | table | postgres | yes | no | - | - | r | - | - | rawdDxt |
| `public.conferences` | table | postgres | yes | no | - | - | r | - | - | rawdDxt |
| `public.debate_states` | table | postgres | yes | no | - | - | r | - | - | rawdDxt |
| `public.delegates` | table | postgres | yes | no | - | - | r | - | - | rawdDxt |
| `public.document_comments` | table | postgres | yes | no | - | - | r | - | - | rawdDxt |
| `public.document_decisions` | table | postgres | yes | no | - | - | r | - | - | rawdDxt |
| `public.document_versions` | table | postgres | yes | no | - | - | r | - | - | rawdDxt |
| `public.documents` | table | postgres | yes | no | - | - | r | - | - | rawdDxt |
| `public.operational_changes` | table | postgres | yes | no | - | - | r | - | - | rawdDxt |
| `public.participation_adjustments` | table | postgres | yes | no | - | - | r | - | - | rawdDxt |
| `public.participation_corrections` | table | postgres | yes | no | - | - | r | - | - | rawdDxt |
| `public.participation_events` | table | postgres | yes | no | - | - | r | - | - | rawdDxt |
| `public.participation_history` | view | postgres | n/a | n/a | security_invoker=true | - | r | - | - | rawdDxt |
| `public.photo_acknowledgements` | table | postgres | yes | no | - | - | r | - | - | rawdDxt |
| `public.photo_list_epochs` | table | postgres | yes | no | - | - | r | - | - | rawdDxt |
| `public.photo_slots` | table | postgres | yes | no | - | - | r | - | - | rawdDxt |
| `public.poi_queue` | table | postgres | yes | no | - | - | r | - | - | rawdDxt |
| `public.resolution_links` | table | postgres | yes | no | - | - | r | - | - | rawdDxt |
| `public.schools` | table | postgres | yes | no | - | - | r | - | - | rawdDxt |
| `public.scoring_definitions` | table | postgres | yes | no | - | - | r | - | - | rawdDxt |
| `public.sessions` | table | postgres | yes | no | - | - | r | - | - | rawdDxt |
| `public.speaker_queue` | table | postgres | yes | no | - | - | r | - | - | rawdDxt |
| `public.speeches` | table | postgres | yes | no | - | - | r | - | - | rawdDxt |
| `public.staff` | table | postgres | yes | no | - | - | r | - | - | rawdDxt |
| `public.submission_links` | table | postgres | yes | no | - | - | r | - | - | rawdDxt |
| `public.timers` | table | postgres | yes | no | - | - | r | - | - | rawdDxt |
| `public.user_access` | table | postgres | yes | no | - | - | r | - | - | rawdDxt |
| `public.votes` | table | postgres | yes | no | - | - | r | - | - | rawdDxt |

### Tables with RLS disabled (0)

- none

### Tables where a Data API role holds a mutating table privilege (0)

With RLS enabled these still need a permissive policy; with RLS disabled they are directly writable.

- none

Column-level privileges: none.

## RLS policies

42 policies.

| Table | Policy | Command | Roles | Permissive | USING | WITH CHECK |
| --- | --- | --- | --- | --- | --- | --- |
| `private.access_credentials` | no_browser_access | ALL | anon,authenticated | yes | false | false |
| `private.access_grant_sources` | no_browser_access | ALL | anon,authenticated | yes | false | false |
| `private.access_redemption_attempts` | no_browser_access | ALL | anon,authenticated | yes | false | false |
| `private.amendment_submissions` | no_browser_access | ALL | anon,authenticated | yes | false | false |
| `private.mutation_receipts` | no_browser_access | ALL | anon,authenticated | yes | false | false |
| `private.resolution_submissions` | no_browser_access | ALL | anon,authenticated | yes | false | false |
| `public.amendment_links` | read_authorized | SELECT | authenticated | yes | private.has_access(conference_id, committee_id, ARRAY['admin'::conference_role, 'chair'::conference_role]) | - |
| `public.amendments` | read_authorized | SELECT | authenticated | yes | private.has_access(conference_id, committee_id, ARRAY['admin'::conference_role, 'chair'::conference_role]) | - |
| `public.attendance` | read_authorized | SELECT | authenticated | yes | private.has_access(conference_id, committee_id, ARRAY['admin'::conference_role, 'chair'::conference_role, 'observer'::conference_role]) | - |
| `public.audit_log` | read_authorized | SELECT | authenticated | yes | private.has_access(conference_id, committee_id, ARRAY['admin'::conference_role]) | - |
| `public.award_criteria` | read_authorized | SELECT | authenticated | yes | (private.has_access(conference_id, committee_id, ARRAY['admin'::conference_role, 'chair'::conference_role, 'observer'::conference_role]) OR ((committee_id IS... | - |
| `public.award_scores` | read_authorized | SELECT | authenticated | yes | private.has_access(conference_id, committee_id, ARRAY['admin'::conference_role, 'chair'::conference_role, 'observer'::conference_role]) | - |
| `public.committee_staff` | read_authorized | SELECT | authenticated | yes | private.has_access(conference_id, committee_id, ARRAY['admin'::conference_role, 'chair'::conference_role, 'observer'::conference_role]) | - |
| `public.committees` | read_authorized | SELECT | authenticated | yes | private.has_access(conference_id, id, ARRAY['admin'::conference_role, 'chair'::conference_role, 'approval'::conference_role, 'logistics'::conference_role, 'o... | - |
| `public.conference_session_slots` | read_authorized | SELECT | authenticated | yes | private.has_access(conference_id, NULL::uuid, ARRAY['admin'::conference_role, 'chair'::conference_role, 'approval'::conference_role, 'logistics'::conference_... | - |
| `public.conference_staff` | read_authorized | SELECT | authenticated | yes | private.has_access(conference_id, NULL::uuid, ARRAY['admin'::conference_role]) | - |
| `public.conferences` | read_authorized | SELECT | authenticated | yes | (EXISTS ( SELECT 1 FROM user_access a WHERE (a.conference_id = conferences.id))) | - |
| `public.debate_states` | read_authorized | SELECT | authenticated | yes | private.has_access(conference_id, committee_id, ARRAY['chair'::conference_role, 'admin'::conference_role, 'observer'::conference_role]) | - |
| `public.delegates` | read_authorized | SELECT | authenticated | yes | private.has_access(conference_id, committee_id, ARRAY['admin'::conference_role, 'chair'::conference_role, 'observer'::conference_role]) | - |
| `public.document_comments` | read_authorized | SELECT | authenticated | yes | (EXISTS ( SELECT 1 FROM documents d WHERE (d.id = document_comments."documentId"))) | - |
| `public.document_decisions` | read_authorized | SELECT | authenticated | yes | (EXISTS ( SELECT 1 FROM documents d WHERE (d.id = document_decisions."documentId"))) | - |
| `public.document_versions` | read_authorized | SELECT | authenticated | yes | (EXISTS ( SELECT 1 FROM documents d WHERE (d.id = document_versions."documentId"))) | - |
| `public.documents` | read_authorized | SELECT | authenticated | yes | (private.has_access(conference_id, committee_id, ARRAY['chair'::conference_role, 'admin'::conference_role, 'observer'::conference_role]) OR ((status = ANY (A... | - |
| `public.operational_changes` | read_authorized | SELECT | authenticated | yes | private.has_access(conference_id, committee_id, ARRAY['admin'::conference_role, 'chair'::conference_role, 'approval'::conference_role, 'logistics'::conferenc... | - |
| `public.participation_adjustments` | read_authorized | SELECT | authenticated | yes | private.has_access(conference_id, committee_id, ARRAY['admin'::conference_role, 'chair'::conference_role, 'observer'::conference_role]) | - |
| `public.participation_corrections` | read_authorized | SELECT | authenticated | yes | private.has_access(conference_id, committee_id, ARRAY['admin'::conference_role, 'chair'::conference_role, 'observer'::conference_role]) | - |
| `public.participation_events` | read_authorized | SELECT | authenticated | yes | private.has_access(conference_id, committee_id, ARRAY['admin'::conference_role, 'chair'::conference_role, 'observer'::conference_role]) | - |
| `public.photo_acknowledgements` | read_authorized | SELECT | authenticated | yes | private.has_access(conference_id, committee_id, ARRAY['admin'::conference_role, 'chair'::conference_role, 'observer'::conference_role]) | - |
| `public.photo_list_epochs` | read_authorized | SELECT | authenticated | yes | private.has_access(conference_id, committee_id, ARRAY['admin'::conference_role, 'chair'::conference_role, 'observer'::conference_role]) | - |
| `public.photo_slots` | read_authorized | SELECT | authenticated | yes | (private.has_access(conference_id, NULL::uuid, ARRAY['admin'::conference_role, 'chair'::conference_role, 'approval'::conference_role, 'logistics'::conference... | - |
| `public.poi_queue` | read_authorized | SELECT | authenticated | yes | private.has_access(conference_id, committee_id, ARRAY['chair'::conference_role, 'admin'::conference_role, 'observer'::conference_role]) | - |
| `public.resolution_links` | read_authorized | SELECT | authenticated | yes | (EXISTS ( SELECT 1 FROM documents d WHERE (d.id = resolution_links.document_id))) | - |
| `public.schools` | read_authorized | SELECT | authenticated | yes | (private.has_access(conference_id, NULL::uuid, ARRAY['admin'::conference_role, 'chair'::conference_role, 'observer'::conference_role]) OR (EXISTS ( SELECT 1 ... | - |
| `public.scoring_definitions` | read_authorized | SELECT | authenticated | yes | (private.has_access(conference_id, committee_id, ARRAY['admin'::conference_role, 'chair'::conference_role, 'observer'::conference_role]) OR ((committee_id IS... | - |
| `public.sessions` | read_authorized | SELECT | authenticated | yes | private.has_access(conference_id, committee_id, ARRAY['admin'::conference_role, 'chair'::conference_role, 'approval'::conference_role, 'logistics'::conferenc... | - |
| `public.speaker_queue` | read_authorized | SELECT | authenticated | yes | private.has_access(conference_id, committee_id, ARRAY['admin'::conference_role, 'chair'::conference_role, 'observer'::conference_role]) | - |
| `public.speeches` | read_authorized | SELECT | authenticated | yes | private.has_access(conference_id, committee_id, ARRAY['chair'::conference_role, 'admin'::conference_role, 'observer'::conference_role]) | - |
| `public.staff` | read_authorized | SELECT | authenticated | yes | private.has_access(conference_id, NULL::uuid, ARRAY['admin'::conference_role]) | - |
| `public.submission_links` | read_authorized | SELECT | authenticated | yes | private.has_access(conference_id, committee_id, ARRAY['admin'::conference_role, 'chair'::conference_role]) | - |
| `public.timers` | read_authorized | SELECT | authenticated | yes | private.has_access(conference_id, committee_id, ARRAY['admin'::conference_role, 'chair'::conference_role, 'observer'::conference_role]) | - |
| `public.user_access` | read_authorized | SELECT | authenticated | yes | ((user_id = ( SELECT auth.uid() AS uid)) AND (revoked_at IS NULL) AND (expires_at > now())) | - |
| `public.votes` | read_authorized | SELECT | authenticated | yes | private.has_access(conference_id, committee_id, ARRAY['admin'::conference_role, 'chair'::conference_role, 'observer'::conference_role]) | - |


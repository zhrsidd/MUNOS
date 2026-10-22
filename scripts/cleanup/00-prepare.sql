-- SYNTHETIC-CONFERENCE CLEANUP, part 0 of 3: guards, rules, counts and the confirmation digest.
--
-- NOT A MIGRATION. This directory is deliberately outside supabase/migrations: it must never become part of the schema, and it
-- only ever runs inside a transaction opened by scripts/cleanup-synthetic.mts (or a human following docs/SYNTHETIC_CLEANUP.md).
-- Running it, or anything in this directory, against a hosted project needs the OWNER'S SEPARATE APPROVAL. Preparing it does not.
--
-- The caller (the wrapper) has already opened `begin` and set these transaction-local settings:
--   munos_cleanup.mode       'dry-run' | 'execute'
--   munos_cleanup.label      the verified project ref (hosted) or a local test label; part of the digest
--   munos_cleanup.ids        comma-separated lower-case conference UUIDs: the ONLY conferences this run may touch
--   munos_cleanup.protected  comma-separated lower-case UUIDs that must never be touched (NEXT_PUBLIC_CONFERENCE_ID and
--                            PROTECTED_CONFERENCE_IDS); empty or missing REFUSES (fail closed)
-- It creates temp tables (dropped at commit/rollback) and writes NOTHING outside them. Parts 1 (dry-run report) and 2 (execute)
-- read the temp tables. Every refusal is an exception whose message starts with "REFUSED" (SQLSTATE MR001); a failed count
-- assertion is "COUNT MISMATCH" (MR002); either aborts the surrounding transaction, so nothing is left half-deleted.

create temp table cleanup_rules (
  seq int primary key, tbl text not null, kind text not null check (kind in ('delete', 'update')),
  scope text not null,            -- WHERE fragment over alias t, limited to the target conferences
  setsql text,                    -- kind 'update' only
  exact boolean not null default true, -- false: the delete may remove MORE rows than counted (a trigger adds them); never fewer
  why text
) on commit drop;
create temp table cleanup_targets (id uuid primary key, name text not null, venue text not null, features jsonb not null) on commit drop;
create temp table cleanup_counts (seq int primary key, tbl text not null, kind text not null, n bigint not null, fp text not null, exact boolean not null) on commit drop;
create temp table cleanup_storage (source text not null, key text not null) on commit drop;
create temp table cleanup_auth (user_id uuid primary key) on commit drop;
create temp table cleanup_auth_other (user_id uuid primary key) on commit drop;
create temp table cleanup_state (k text primary key, v text not null) on commit drop;

-- The deletion order. A child is listed before every parent it references (tests/synthetic-cleanup-schema.test.ts proves this
-- against the live foreign keys). T = the target conferences. A table with no rule here makes the run REFUSE (schema drift).
insert into cleanup_rules(seq, tbl, kind, scope, setsql, exact, why) values
 (1,  'private.access_grant_sources',  'delete', 't.user_access_id in (select id from public.user_access where conference_id in (select id from pg_temp.cleanup_targets)) or t.credential_id in (select id from private.access_credentials where conference_id in (select id from pg_temp.cleanup_targets))', null, true, 'no conference_id; scoped through its grant or credential'),
 (2,  'private.amendment_submissions', 'delete', 't.link_id in (select id from public.amendment_links where conference_id in (select id from pg_temp.cleanup_targets)) or t.amendment_id in (select id from public.amendments where conference_id in (select id from pg_temp.cleanup_targets))', null, true, 'no conference_id; scoped through its link or amendment'),
 (3,  'private.resolution_submissions','delete', 't.conference_id in (select id from pg_temp.cleanup_targets)', null, true, null),
 (4,  'private.mutation_receipts',     'delete', 't.conference_id in (select id from pg_temp.cleanup_targets)', null, true, null),
 (5,  'private.access_redemption_attempts','delete','t.conference_id in (select id from pg_temp.cleanup_targets)', null, true, null),
 (6,  'public.participation_corrections','delete','t.conference_id in (select id from pg_temp.cleanup_targets)', null, true, null),
 (7,  'public.photo_acknowledgements', 'delete', 't.conference_id in (select id from pg_temp.cleanup_targets)', null, true, null),
 (8,  'public.document_decisions',     'delete', 't.conference_id in (select id from pg_temp.cleanup_targets)', null, true, 'before document_comments (commentId)'),
 (9,  'public.document_comments',      'delete', 't.conference_id in (select id from pg_temp.cleanup_targets)', null, true, null),
 (10, 'public.document_versions',      'delete', 't.conference_id in (select id from pg_temp.cleanup_targets)', null, true, 'its storageKey values are the Storage objects to remove by hand'),
 (11, 'public.resolution_links',       'delete', 't.conference_id in (select id from pg_temp.cleanup_targets)', null, true, null),
 (12, 'public.poi_queue',              'delete', 't.conference_id in (select id from pg_temp.cleanup_targets)', null, true, null),
 (13, 'public.participation_events',   'delete', 't.conference_id in (select id from pg_temp.cleanup_targets)', null, true, null),
 (14, 'public.votes',                  'delete', 't.conference_id in (select id from pg_temp.cleanup_targets)', null, true, null),
 (15, 'public.speeches',               'delete', 't.conference_id in (select id from pg_temp.cleanup_targets)', null, true, 'self-reference (yieldedFrom) is satisfied within one statement'),
 (16, 'public.amendments',             'delete', 't.conference_id in (select id from pg_temp.cleanup_targets)', null, true, null),
 (17, 'public.participation_adjustments','delete','t.conference_id in (select id from pg_temp.cleanup_targets)', null, true, 'self-reference (reverses) is satisfied within one statement'),
 (18, 'public.attendance',             'delete', 't.conference_id in (select id from pg_temp.cleanup_targets)', null, true, null),
 (19, 'public.speaker_queue',          'delete', 't.conference_id in (select id from pg_temp.cleanup_targets)', null, true, null),
 (20, 'public.timers',                 'delete', 't.conference_id in (select id from pg_temp.cleanup_targets)', null, true, null),
 (21, 'public.debate_states',          'delete', 't.conference_id in (select id from pg_temp.cleanup_targets)', null, true, null),
 (22, 'public.award_scores',           'delete', 't.conference_id in (select id from pg_temp.cleanup_targets)', null, true, null),
 (23, 'public.award_criteria',         'delete', 't.conference_id in (select id from pg_temp.cleanup_targets)', null, true, null),
 (24, 'public.documents',              'delete', 't.conference_id in (select id from pg_temp.cleanup_targets)', null, true, null),
 (25, 'public.committees',             'update', 't.conference_id in (select id from pg_temp.cleanup_targets) and t."currentSessionId" is not null', '"currentSessionId" = null', true, 'breaks the committees <-> sessions cycle; the rows are deleted at step 42'),
 (26, 'public.sessions',               'delete', 't.conference_id in (select id from pg_temp.cleanup_targets)', null, true, null),
 (27, 'public.conference_session_slots','delete','t.conference_id in (select id from pg_temp.cleanup_targets)', null, true, null),
 (28, 'public.scoring_definitions',    'delete', 't.conference_id in (select id from pg_temp.cleanup_targets)', null, true, null),
 (29, 'public.submission_links',       'delete', 't.conference_id in (select id from pg_temp.cleanup_targets)', null, true, null),
 (30, 'public.amendment_links',        'delete', 't.conference_id in (select id from pg_temp.cleanup_targets)', null, true, null),
 (31, 'private.access_credentials',    'delete', 't.conference_id in (select id from pg_temp.cleanup_targets)', null, true, null),
 (32, 'public.user_access',            'delete', 't.conference_id in (select id from pg_temp.cleanup_targets)', null, true, null),
 (33, 'public.committee_staff',        'delete', 't.conference_id in (select id from pg_temp.cleanup_targets)', null, true, 'its delete trigger (photo epochs) writes photo_list_epochs, hence step 35 is not exact'),
 (34, 'public.conference_staff',       'delete', 't.conference_id in (select id from pg_temp.cleanup_targets)', null, true, 'same trigger as step 33'),
 (35, 'public.photo_list_epochs',      'delete', 't.conference_id in (select id from pg_temp.cleanup_targets)', null, false, 'trigger side effects of steps 33-34 may add rows for the same conference: deleted >= counted, remaining must be 0'),
 (36, 'public.photo_slots',            'delete', 't.conference_id in (select id from pg_temp.cleanup_targets)', null, true, null),
 (37, 'public.staff',                  'delete', 't.conference_id in (select id from pg_temp.cleanup_targets)', null, true, 'the public.staff row only; the Auth user (auth_user_id) is a separate listed step'),
 (38, 'public.delegates',              'delete', 't.conference_id in (select id from pg_temp.cleanup_targets)', null, true, null),
 (39, 'public.schools',                'delete', 't.conference_id in (select id from pg_temp.cleanup_targets)', null, true, null),
 (40, 'public.audit_log',              'delete', 't.conference_id in (select id from pg_temp.cleanup_targets)', null, true, null),
 (41, 'public.operational_changes',    'delete', 't.conference_id in (select id from pg_temp.cleanup_targets)', null, true, null),
 (42, 'public.committees',             'delete', 't.conference_id in (select id from pg_temp.cleanup_targets)', null, true, null),
 (43, 'public.conferences',            'delete', 't.id in (select id from pg_temp.cleanup_targets)', null, true, 'last: the conference row itself');

-- Anything but 'execute' is read only from here on (temp tables stay writable). This is the dry run's guarantee that it cannot change data.
do $readonly$
begin
  if coalesce(nullif(current_setting('munos_cleanup.mode', true), ''), 'dry-run') <> 'execute' then set transaction read only; end if;
end
$readonly$;

do $prepare$
declare
  v_mode text := coalesce(nullif(current_setting('munos_cleanup.mode', true), ''), 'dry-run');
  v_label text := nullif(current_setting('munos_cleanup.label', true), '');
  v_ids_raw text := current_setting('munos_cleanup.ids', true);
  v_prot_raw text := current_setting('munos_cleanup.protected', true);
  v_ids uuid[] := '{}';
  v_prot uuid[] := '{}';
  -- THE SYNTHETIC RULE. A conference may be deleted only if its name starts with one of these (case-sensitive), is not flagged
  -- real, is not protected, has no active access and is named explicitly. chr(183) is the middle dot used by the load-test
  -- fixture label 'LOAD TEST · ...'. Widening this list is a reviewed code change, never a command-line option.
  v_prefixes text[] := array['LOAD TEST ' || chr(183) || ' ', 'DCMUN Development Test', 'SYNTHETIC ' || chr(183) || ' '];
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  part text; r record; n bigint; fp text; msg text; canon text; h_grants bigint; h_creds bigint; h_sub bigint; h_amd bigint; crosses_scope boolean;
begin
  if v_mode not in ('dry-run', 'execute') then raise exception 'REFUSED: unknown mode' using errcode = 'MR001'; end if;
  if v_label is null or v_label !~ '^[a-z0-9][a-z0-9_.-]{0,62}$' then raise exception 'REFUSED: the target label is missing or malformed' using errcode = 'MR001'; end if;

  -- 1. The explicit id list: non-empty, canonical, unique.
  if v_ids_raw is null or btrim(v_ids_raw) = '' then raise exception 'REFUSED: no conference ids were named; this tool never selects conferences by pattern' using errcode = 'MR001'; end if;
  foreach part in array string_to_array(v_ids_raw, ',') loop
    part := btrim(part);
    if part !~ v_uuid then raise exception 'REFUSED: a listed conference id is not a lower-case canonical UUID' using errcode = 'MR001'; end if;
    if part::uuid = any(v_ids) then raise exception 'REFUSED: conference id % is listed twice', part using errcode = 'MR001'; end if;
    v_ids := array_append(v_ids, part::uuid);
  end loop;

  -- 2. The protected list: required (fail closed), canonical, and disjoint from the ids.
  if v_prot_raw is null or btrim(v_prot_raw) = '' then raise exception 'REFUSED: the protected conference list is empty or missing; set NEXT_PUBLIC_CONFERENCE_ID (fail closed)' using errcode = 'MR001'; end if;
  foreach part in array string_to_array(v_prot_raw, ',') loop
    part := btrim(part);
    if part !~ v_uuid then raise exception 'REFUSED: a protected conference id is not a lower-case canonical UUID' using errcode = 'MR001'; end if;
    v_prot := array_append(v_prot, part::uuid);
  end loop;
  select i::text into msg from unnest(v_ids) i where i = any(v_prot) limit 1;
  if msg is not null then raise exception 'REFUSED: conference % is protected (NEXT_PUBLIC_CONFERENCE_ID or PROTECTED_CONFERENCE_IDS)', msg using errcode = 'MR001'; end if;

  -- 3. The connected role must see every row (counts under RLS would silently be zero).
  if not exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception 'REFUSED: role % can neither bypass row-level security nor is a superuser, so counts would be unreliable', current_user using errcode = 'MR001';
  end if;

  -- 4. Schema drift: every base table in public and private must have a rule, and no rule may name a missing table.
  select string_agg(x.name, ', ' order by x.name) into msg from (
    select format('%I.%I', ns.nspname, c.relname) as name from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
     where c.relkind in ('r', 'p') and not c.relispartition and ns.nspname in ('public', 'private')) x
   where x.name not in (select tbl from cleanup_rules);
  if msg is not null then raise exception 'REFUSED: tables without a cleanup rule (schema drift; update scripts/cleanup/00-prepare.sql after review): %', msg using errcode = 'MR001'; end if;
  select string_agg(distinct tbl, ', ') into msg from cleanup_rules where to_regclass(tbl) is null;
  if msg is not null then raise exception 'REFUSED: cleanup rules name tables that do not exist: %', msg using errcode = 'MR001'; end if;
  select string_agg(format('%I.%I', ns.nspname, c.relname), ', ') into msg from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace ns on ns.oid = c.relnamespace
   where k.contype = 'f' and k.confrelid in (select to_regclass(tbl) from cleanup_rules where kind = 'delete')
     and k.conrelid not in (select to_regclass(tbl) from cleanup_rules where kind = 'delete');
  if msg is not null then raise exception 'REFUSED: unreviewed incoming foreign keys reference cleanup tables: %', msg using errcode = 'MR001'; end if;

  -- 5. Execute only: lock every cleanup table so the counts below are the counts the deletes see.
  if v_mode = 'execute' then
    for r in select distinct tbl from cleanup_rules order by tbl loop execute format('lock table %s in share row exclusive mode', r.tbl); end loop;
  end if;

  -- 6. Targets, the synthetic rule and the real flag.
  insert into cleanup_targets select id, name, venue, features from public.conferences where id = any(v_ids);
  for r in select * from cleanup_targets order by id loop
    if not exists (select 1 from unnest(v_prefixes) p where left(r.name, length(p)) = p) then
      raise exception 'REFUSED: conference % ("%") is not marked synthetic: its name does not start with an approved synthetic prefix', r.id, r.name using errcode = 'MR001';
    end if;
    if lower(coalesce(r.features ->> 'real', 'false')) in ('true', 't', '1', 'yes') then
      raise exception 'REFUSED: conference % is flagged real (features.real)', r.id using errcode = 'MR001';
    end if;
  end loop;

  -- Every FK between cleanup tables must stay wholly within the selected or retained rows.
  -- This includes junction rows without conference_id: selecting either parent never authorises deleting the other parent's provenance.
  for r in
    select k.conname, child.tbl as child_tbl, parent.tbl as parent_tbl, child.scope as child_scope,
      replace(parent.scope, 't.', 'p.') as parent_scope,
      (select string_agg(format('t.%I = p.%I', ca.attname, pa.attname), ' and ' order by pos.i)
         from generate_subscripts(k.conkey, 1) pos(i)
         join pg_attribute ca on ca.attrelid = k.conrelid and ca.attnum = k.conkey[pos.i]
         join pg_attribute pa on pa.attrelid = k.confrelid and pa.attnum = k.confkey[pos.i]) as key_join
    from pg_constraint k
    join cleanup_rules child on child.kind = 'delete' and to_regclass(child.tbl) = k.conrelid
    join cleanup_rules parent on parent.kind = 'delete' and to_regclass(parent.tbl) = k.confrelid
    where k.contype = 'f'
    order by child.tbl, k.conname
  loop
    execute format('select exists(select 1 from %s t join %s p on %s where ((%s) is true) <> ((%s) is true))',
      r.child_tbl, r.parent_tbl, r.key_join, r.child_scope, r.parent_scope) into crosses_scope;
    if crosses_scope then
      raise exception 'REFUSED: foreign key % spans selected and retained rows (% -> %)', r.conname, r.child_tbl, r.parent_tbl using errcode = 'MR001';
    end if;
  end loop;

  -- 7. No active access: revoke first. Active = not revoked and not expired.
  select count(*) filter (where k = 'grant'), count(*) filter (where k = 'credential'), count(*) filter (where k = 'submission link'), count(*) filter (where k = 'amendment link')
    into h_grants, h_creds, h_sub, h_amd
    from (
      select 'grant' as k from public.user_access where conference_id in (select id from cleanup_targets) and revoked_at is null and (expires_at is null or expires_at > now())
      union all select 'credential' from private.access_credentials where conference_id in (select id from cleanup_targets) and revoked_at is null and (expires_at is null or expires_at > now())
      union all select 'submission link' from public.submission_links where conference_id in (select id from cleanup_targets) and revoked_at is null
      union all select 'amendment link' from public.amendment_links where conference_id in (select id from cleanup_targets) and revoked_at is null) a;
  if h_grants + h_creds + h_sub + h_amd > 0 then
    raise exception 'REFUSED: active access remains (% grants, % credentials, % submission links, % amendment links); revoke first with the fixture cleanup.sql', h_grants, h_creds, h_sub, h_amd using errcode = 'MR001';
  end if;

  -- 8. Per-table row counts and a content fingerprint of exactly the rows each delete would remove.
  for r in select * from cleanup_rules order by seq loop
    execute format('select count(*), coalesce(md5(string_agg(md5(t::text), %L order by md5(t::text))), %L) from %s t where %s', ',', '', r.tbl, r.scope) into n, fp;
    insert into cleanup_counts values (r.seq, r.tbl, r.kind, n, fp, r.exact);
  end loop;

  -- 9. Storage objects: the keys recorded in the database, and (read only) any object under a target prefix.
  insert into cleanup_storage select 'document_versions', v."storageKey" from public.document_versions v where v.conference_id in (select id from cleanup_targets) and v."storageKey" is not null;
  if to_regclass('storage.objects') is not null then
    execute 'insert into cleanup_storage select ''bucket:'' || o.bucket_id, o.name from storage.objects o where split_part(o.name, ''/'', 1) = any($1)' using (select array_agg(i::text) from unnest(v_ids) i);
  end if;

  -- 10. Auth users only the target conferences reference (candidates for a SEPARATE, listed Auth-admin step; never deleted here).
  -- Every foreign key to auth.users, plus the one column that names a user without a key (a redemption attempt's device user).
  for r in select format('%I.%I', ns.nspname, c.relname) as tbl, a.attname::text as col
             from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace ns on ns.oid = c.relnamespace join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
            where k.contype = 'f' and k.confrelid = to_regclass('auth.users') and array_length(k.conkey, 1) = 1 and ns.nspname in ('public', 'private')
           union select 'private.access_redemption_attempts', 'user_id' loop
    for fp in select scope from cleanup_rules where tbl = r.tbl and kind = 'delete' loop
      execute format('insert into cleanup_auth select distinct t.%I from %s t where (%s) and t.%I is not null on conflict do nothing', r.col, r.tbl, fp, r.col);
      execute format('insert into cleanup_auth_other select distinct t.%I from %s t where not (%s) and t.%I is not null on conflict do nothing', r.col, r.tbl, fp, r.col);
    end loop;
  end loop;
  delete from cleanup_auth where user_id in (select user_id from cleanup_auth_other);

  -- 11. The digest binds the project, the id list, the targets' names, every count and fingerprint, and the listed keys/users.
  canon := 'munos-synthetic-cleanup-v1' || E'\n' || 'target=' || v_label || E'\n'
    || 'ids=' || (select string_agg(i::text, ',' order by i) from unnest(v_ids) i) || E'\n';
  for r in select * from cleanup_targets order by id loop canon := canon || 'conference=' || r.id || '|' || r.name || '|' || r.venue || E'\n'; end loop;
  for r in select i from unnest(v_ids) i where i not in (select id from cleanup_targets) order by i loop canon := canon || 'absent=' || r.i || E'\n'; end loop;
  for r in select * from cleanup_counts order by seq loop canon := canon || 'table=' || r.seq || '|' || r.tbl || '|' || r.kind || '|' || r.n || '|' || r.fp || E'\n'; end loop;
  canon := canon || 'storage=' || (select count(*) from cleanup_storage) || '|' || (select coalesce(md5(string_agg(source || ':' || key, ',' order by source, key)), '') from cleanup_storage) || E'\n'
    || 'auth=' || (select count(*) from cleanup_auth) || '|' || (select coalesce(md5(string_agg(user_id::text, ',' order by user_id)), '') from cleanup_auth) || E'\n';
  insert into cleanup_state values ('mode', v_mode), ('label', v_label), ('ids', array_to_string(v_ids, ',')), ('digest', encode(sha256(convert_to(canon, 'UTF8')), 'hex'));
end
$prepare$;

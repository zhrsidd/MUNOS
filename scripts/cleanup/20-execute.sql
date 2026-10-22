-- SYNTHETIC-CONFERENCE CLEANUP, part 2 of 3: the deletion. Requires 00-prepare.sql in the same transaction with
-- munos_cleanup.mode = 'execute' (which locked every cleanup table before counting) and munos_cleanup.token set.
-- Everything here is one transaction: any exception (token mismatch, count mismatch, foreign-key violation, rows left behind)
-- aborts it and nothing is removed. Storage objects and Auth users are NOT touched here.
create temp table cleanup_result (seq int primary key, tbl text not null, kind text not null, expected bigint not null, affected bigint not null) on commit drop;
do $execute$
declare
  v_token text := nullif(current_setting('munos_cleanup.token', true), '');
  v_digest text := (select v from cleanup_state where k = 'digest');
  r record; expected bigint; n bigint;
begin
  if (select v from cleanup_state where k = 'mode') <> 'execute' then raise exception 'REFUSED: not prepared in execute mode' using errcode = 'MR001'; end if;
  if v_token is null or v_token !~ '^[0-9a-f]{64}$' then raise exception 'REFUSED: the confirmation token is missing or malformed' using errcode = 'MR001'; end if;
  if v_token <> v_digest then
    raise exception 'REFUSED: the confirmation token does not match the current dry run (the ids, the project or the data changed, or the token is for different input); run the dry run again and review it' using errcode = 'MR001';
  end if;
  for r in select * from cleanup_rules order by seq loop
    select c.n into expected from cleanup_counts c where c.seq = r.seq;
    if r.kind = 'update' then execute format('update %s t set %s where %s', r.tbl, r.setsql, r.scope);
    else execute format('delete from %s t where %s', r.tbl, r.scope);
    end if;
    get diagnostics n = row_count;
    if n <> expected and (r.exact or n < expected) then
      raise exception 'COUNT MISMATCH at step % (%): the dry run counted % rows, the statement affected %; nothing was deleted', r.seq, r.tbl, expected, n using errcode = 'MR002';
    end if;
    insert into cleanup_result values (r.seq, r.tbl, r.kind, expected, n);
  end loop;
  -- Nothing may remain for the targets.
  for r in select * from cleanup_rules where kind = 'delete' order by seq loop
    execute format('select count(*) from %s t where %s', r.tbl, r.scope) into n;
    if n <> 0 then raise exception 'COUNT MISMATCH: % rows remain in % after the delete; nothing was deleted', n, r.tbl using errcode = 'MR002'; end if;
  end loop;
end
$execute$;
select 'MUNOS_CLEANUP_JSON ' || jsonb_build_object(
  'kind', 'execute',
  'status', case when exists (select 1 from cleanup_targets) then 'deleted' else 'nothing_to_delete' end,
  'label', (select v from cleanup_state where k = 'label'),
  'token', (select v from cleanup_state where k = 'digest'),
  'executed_at', now(),
  'conferences', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'venue', venue) order by id) from cleanup_targets), '[]'),
  'tables', (select jsonb_agg(jsonb_build_object('seq', seq, 'table', tbl, 'kind', kind, 'expected', expected, 'affected', affected) order by seq) from cleanup_result),
  'total_rows_deleted', (select coalesce(sum(affected), 0) from cleanup_result where kind = 'delete'),
  'storage', jsonb_build_object(
    'document_version_keys', coalesce((select jsonb_agg(key order by key) from cleanup_storage where source = 'document_versions'), '[]'),
    'bucket_objects', coalesce((select jsonb_agg(jsonb_build_object('bucket', substr(source, 8), 'key', key) order by source, key) from cleanup_storage where source <> 'document_versions'), '[]'),
    'note', 'Storage objects were NOT deleted by this step. Remove them as the separate, human-confirmed step in docs/SYNTHETIC_CLEANUP.md.'),
  'auth_user_candidates', coalesce((select jsonb_agg(user_id order by user_id) from cleanup_auth), '[]')
)::text;

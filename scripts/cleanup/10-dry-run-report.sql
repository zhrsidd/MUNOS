-- SYNTHETIC-CONFERENCE CLEANUP, part 1 of 3: the dry-run report. Read only. Requires 00-prepare.sql in the same transaction.
-- One line of JSON prefixed MUNOS_CLEANUP_JSON. The digest is the confirmation token for part 2 (execute).
select 'MUNOS_CLEANUP_JSON ' || jsonb_build_object(
  'kind', 'dry-run',
  'status', case when exists (select 1 from cleanup_targets) then 'ready' else 'nothing_to_delete' end,
  'label', (select v from cleanup_state where k = 'label'),
  'token', (select v from cleanup_state where k = 'digest'),
  'conferences', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'venue', venue) order by id) from cleanup_targets), '[]'),
  'absent_ids', coalesce((select jsonb_agg(i order by i) from unnest(string_to_array((select v from cleanup_state where k = 'ids'), ',')) i where i::uuid not in (select id from cleanup_targets)), '[]'),
  'kept_conferences', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'venue', c.venue, 'created_at', c.created_at) order by c.created_at, c.id) from public.conferences c where c.id not in (select id from cleanup_targets)), '[]'),
  'tables', (select jsonb_agg(jsonb_build_object('seq', seq, 'table', tbl, 'kind', kind, 'rows', n, 'exact', exact, 'fingerprint', fp) order by seq) from cleanup_counts),
  'total_rows_deleted_if_executed', (select coalesce(sum(n), 0) from cleanup_counts where kind = 'delete'),
  'storage', jsonb_build_object(
    'document_version_keys', coalesce((select jsonb_agg(key order by key) from cleanup_storage where source = 'document_versions'), '[]'),
    'bucket_objects', coalesce((select jsonb_agg(jsonb_build_object('bucket', substr(source, 8), 'key', key) order by source, key) from cleanup_storage where source <> 'document_versions'), '[]')),
  'auth_user_candidates', coalesce((select jsonb_agg(user_id order by user_id) from cleanup_auth), '[]'),
  'auth_users_kept_because_referenced_elsewhere', (select count(*) from cleanup_auth_other)
)::text;

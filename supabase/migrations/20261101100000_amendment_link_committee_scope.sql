-- Sessions are labels after 20261031090000; an amendment link follows its committee's live resolution.
-- Preserve the public projection, lifecycle/revocation/archive filters and deterministic ordering.
-- CREATE OR REPLACE keeps the existing owner and service-role-only EXECUTE ACL; no privilege change.
create or replace function public.amendment_link_info(link_token text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('committee',jsonb_build_object('id',c.id,'code',c.code,'name',c.name),
  'resolution',(select jsonb_build_object('id',d.id,'code',d.code,'title',d.title,'submitterId',d."submitterId") from public.documents d where d.committee_id=c.id and d.status='In Debate' order by d.created_at,d.id limit 1),
  'delegates',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'country',d.country) order by d.country,d.id),'[]') from public.delegates d where d.committee_id=c.id))
 from public.amendment_links l join public.committees c on c.id=l.committee_id where l.token=link_token and l.revoked_at is null and private.lifecycle_allows(l.test_only) and not c.archived;
$$;

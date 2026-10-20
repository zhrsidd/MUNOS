-- Clear majority For / Against (docs/CLEAR_MAJORITY_VOTING.md; docs/plans/PROTECTED_FEATURES_PLAN.md §1).
-- The Chair may close a vote with a declared, observed majority instead of counted ballots. The method, the
-- declaring Chair and the time are stored; no country choices or totals are created.
-- Allowed only where an observation can establish the result under the current rules: a normal vote (not
-- Divide the House), simple majority, and not a substantive vote in a veto-enabled committee (missing ballots
-- cannot show that no veto was cast). Substantive and procedural votes are both allowed (owner, 20 October).
-- Ballots recorded before an observed close are kept and not counted. The counted path is unchanged.
-- Additive: three columns on documents; private.apply_mutation is PATCHED with exact anchors. Fail closed.

alter table public.documents
 add column "outcomeMethod" text not null default 'counted' check ("outcomeMethod" in ('counted','observed')),
 add column "declaredBy" uuid,
 add column "declaredAt" timestamptz,
 add constraint documents_observed_declared check ("outcomeMethod"='counted' or ("declaredBy" is not null and "declaredAt" is not null and outcome in ('Passed','Failed')));

-- Replace exactly one occurrence of an anchor or stop the migration.
create or replace function pg_temp.patch_once(definition text,anchor text,replacement text,label text) returns text language plpgsql as $$
begin
 if (length(definition)-length(replace(definition,anchor,'')))<>length(anchor) then raise exception '% changed; review before applying',label; end if;
 return replace(definition,anchor,replacement);
end $$;

do $patch$
declare definition text;
begin
 definition:=pg_get_functiondef('private.apply_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz)'::regprocedure);
 -- 1) Validate an observed close; the counted branch below stays byte for byte.
 definition:=pg_temp.patch_once(definition,
  $q$     if command->>'outcome'='Withdrawn' then result:='Withdrawn';$q$,
  $q$     if command ? 'method' and command->>'method' is distinct from 'observed' then raise exception 'Unknown voting method' using errcode='22023'; end if;
     if command->>'outcome'='Withdrawn' then result:='Withdrawn';
     elsif command->>'method'='observed' then
       select coalesce(c.voting_rule,f.voting_rule) into rule from public.committees c join public.conferences f on f.id=c.conference_id where c.id=cid;
       if rec."voteMode"='divide' then raise exception 'Divide the House needs a counted roll call' using errcode='22023'; end if;
       if rule is distinct from 'simple_majority' then raise exception 'A two-thirds vote needs counted ballots' using errcode='22023'; end if;
       if rec."voteType"='substantive' and (select "vetoEnabled" from public.committees where id=cid) then raise exception 'Only counted ballots can show that no veto was cast' using errcode='22023'; end if;
       if command->>'outcome' is null or command->>'outcome' not in ('Passed','Failed') then raise exception 'Choose Passed or Failed' using errcode='22023'; end if;
       result:=(command->>'outcome')::public.document_outcome;$q$,'apply_mutation observed close');
 -- 2) Record the method, the declaring Chair and the time.
 definition:=pg_temp.patch_once(definition,
  $q$    status=target::public.document_state,outcome=result,revision=revision+1,updated_at=now() where id=rid;$q$,
  $q$    status=target::public.document_state,outcome=result,revision=revision+1,updated_at=now() where id=rid;
   if target='Closed' and command->>'method'='observed' and result<>'Withdrawn' then update public.documents set "outcomeMethod"='observed',"declaredBy"=actor,"declaredAt"=client_time where id=rid; end if;$q$,'apply_mutation observed record');
 execute definition;
end $patch$;

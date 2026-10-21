-- Clear majority For / Against (docs/CLEAR_MAJORITY_VOTING.md; docs/plans/PROTECTED_FEATURES_PLAN.md §1).
-- The Chair may close a vote with a declared, observed majority instead of counted ballots. The method, the
-- declaring Chair (id and staff name, if any) and the time are stored; no country choices or totals are created.
-- Allowed only where an observation can establish the result under the current rules: a normal vote (not
-- Divide the House), simple majority, and not a substantive vote in a veto-enabled committee (missing ballots
-- cannot show that no veto was cast). Substantive and procedural votes are both allowed (owner, 20 October).
-- An observed close skips only named-ballot completeness and the counted-rule comparison. It still needs the
-- ballot's session context (the command names the session the Chair confirmed, which must be the resolution's
-- session) and at least one delegation present in that session: no attendance, or everyone Absent, is refused.
-- The declaration is bound to the ballot revision the Chair opened it on (command ballotRevision, also the expected
-- revision): restarting the ballot, here or from another Chair device, bumps documents.revision and the stale
-- declaration is refused as a PT409 conflict. Ballots recorded before an observed close are kept and not counted. The counted path is unchanged.
-- Additive: four columns on documents; private.apply_mutation is PATCHED with exact anchors. Fail closed.

alter table public.documents
 add column "outcomeMethod" text not null default 'counted' check ("outcomeMethod" in ('counted','observed')),
 add column "declaredBy" uuid,
 add column "declaredByName" text,
 add column "declaredAt" timestamptz,
 -- Every term is NOT NULL-safe, so an observed row with a NULL outcome evaluates false, not unknown (a CHECK
 -- accepts unknown).
 add constraint documents_observed_declared check ("outcomeMethod"='counted' or (outcome is not null and outcome in ('Passed','Failed') and "declaredBy" is not null and "declaredAt" is not null));

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
 -- 1) Validate an observed close; the counted branch below stays byte for byte. Same order as lib/commands.ts.
 definition:=pg_temp.patch_once(definition,
  $q$     if command->>'outcome'='Withdrawn' then result:='Withdrawn';$q$,
  $q$     if command ? 'method' and command->>'method' is distinct from 'observed' then raise exception 'Unknown voting method' using errcode='22023'; end if;
     if command->>'outcome'='Withdrawn' then result:='Withdrawn';
     elsif command->>'method'='observed' then
       if command->>'outcome' is null or command->>'outcome' not in ('Passed','Failed') then raise exception 'Choose Passed or Failed' using errcode='22023'; end if;
       -- Bound to the ballot the Chair saw: a restart (this Chair or another) bumps documents.revision. A missing or
       -- stale ballotRevision is a stale-write conflict, independent of the generic expected-revision check above.
       if (select m[1]::bigint from regexp_match(command->>'ballotRevision','^([0-9]{1,18})$') m) is distinct from rec.revision then raise sqlstate 'PT409' using message='The ballot was restarted or changed since Clear majority was opened. Choose Clear majority again.'; end if;
       select coalesce(c.voting_rule,f.voting_rule) into rule from public.committees c join public.conferences f on f.id=c.conference_id where c.id=cid;
       if rec."voteMode"='divide' then raise exception 'Divide the House needs a counted roll call' using errcode='22023'; end if;
       if rule is distinct from 'simple_majority' then raise exception 'A two-thirds vote needs counted ballots' using errcode='22023'; end if;
       if rec."voteType"='substantive' and (select "vetoEnabled" from public.committees where id=cid) then raise exception 'Only counted ballots can show that no veto was cast' using errcode='22023'; end if;
       -- sid is the resolution's ballot session; the Chair must have confirmed that same session.
       if sid is null or private.uuid_or_null(command->>'sessionId') is distinct from sid then raise exception 'This ballot belongs to a different session' using errcode='22023'; end if;
       select count(*) into n from public.attendance where "sessionId"=sid and status<>'Absent';
       if n=0 then raise exception 'No delegation is present in this ballot''s session' using errcode='22023'; end if;
       result:=(command->>'outcome')::public.document_outcome;$q$,'apply_mutation observed close');
 -- 2) Record the method, the declaring Chair and the time.
 definition:=pg_temp.patch_once(definition,
  $q$    status=target::public.document_state,outcome=result,revision=revision+1,updated_at=now() where id=rid;$q$,
  $q$    status=target::public.document_state,outcome=result,revision=revision+1,updated_at=now() where id=rid;
   if target='Closed' and command->>'method'='observed' and result<>'Withdrawn' then
     update public.documents set "outcomeMethod"='observed',"declaredBy"=actor,"declaredAt"=client_time,
      "declaredByName"=(select s.name from public.staff s where s.auth_user_id=actor and s.conference_id=conf limit 1) where id=rid;
   end if;$q$,'apply_mutation observed record');
 execute definition;
end $patch$;

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {freshDatabase} from './helpers/database';

// Derived from the LIVE schema (every committed migration replayed on PGlite): adding a conference-scoped table, or changing the
// foreign keys so the deletion order is wrong, fails here until scripts/cleanup/00-prepare.sql is updated and reviewed.
interface Rule{seq:number;tbl:string;kind:'delete'|'update';scope:string;setsql:string|null;exact:boolean}
async function load(){
 const d=await freshDatabase({storage:true});
 const source=await readFile('scripts/cleanup/00-prepare.sql','utf8');
 const header=source.slice(0,source.indexOf("-- Anything but 'execute'"));
 assert.ok(header.includes('insert into cleanup_rules'));
 await d.db.exec(`begin; ${header}`);
 const rules=(await d.db.query<Rule>('select seq,tbl,kind,scope,setsql,exact from cleanup_rules order by seq')).rows;
 await d.db.exec('rollback;');
 const q=async<T>(sql:string)=>(await d.db.query<T>(sql)).rows;
 return {d,rules,q};
}
type Q=Awaited<ReturnType<typeof load>>['q'];
const tablesOf=(q:Q)=>q<{tbl:string;scoped:boolean}>(`select format('%I.%I',n.nspname,c.relname) tbl, exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='conference_id' and not a.attisdropped) scoped from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in('r','p') and not c.relispartition and n.nspname in('public','private') order by 1`);
/** Tables the live schema has that no delete rule covers, and rules naming tables the schema lacks. */
async function uncovered(q:Q,rules:Rule[]){
 const live=await tablesOf(q);const ruled=new Set(rules.map(r=>r.tbl));
 return {missing:live.filter(t=>!ruled.has(t.tbl)).map(t=>t.tbl),stale:[...ruled].filter(t=>!live.some(l=>l.tbl===t))};
}

test('every table in public and private has exactly one cleanup rule; every conference_id table is scoped by conference_id',async()=>{
 const {d,rules,q}=await load();
 try{
  const {missing,stale}=await uncovered(q,rules);
  assert.deepEqual(missing,[],`conference-scoped (or other) tables with no cleanup rule: add a reviewed rule to scripts/cleanup/00-prepare.sql: ${missing}`);
  assert.deepEqual(stale,[],'rules naming tables that no longer exist');
  const live=await tablesOf(q);
  const deletes=rules.filter(r=>r.kind==='delete');
  assert.equal(new Set(deletes.map(r=>r.tbl)).size,deletes.length,'one delete rule per table');
  assert.deepEqual(rules.filter(r=>r.kind==='update').map(r=>r.tbl),['public.committees'],'the only pre-step is detaching committees from their current session');
  for(const {tbl,scoped} of live){
   const rule=deletes.find(r=>r.tbl===tbl)!;
   if(scoped)assert.match(rule.scope,/^t\.conference_id in \(select id from pg_temp\.cleanup_targets\)$/,`${tbl} must be scoped by its own conference_id`);
  }
  // Tables WITHOUT a conference_id column are exactly the known set, each scoped through its foreign keys to scoped tables.
  const unscoped=live.filter(t=>!t.scoped).map(t=>t.tbl);
  assert.deepEqual(unscoped,['private.access_grant_sources','private.amendment_submissions','public.conferences'],'a new table without conference_id needs a reviewed scope');
  for(const tbl of ['private.access_grant_sources','private.amendment_submissions']){
   const fkCols=await q<{col:string}>(`select a.attname col from pg_constraint k join pg_attribute a on a.attrelid=k.conrelid and a.attnum=k.conkey[1] where k.contype='f' and k.conrelid='${tbl}'::regclass and k.confrelid in(select c.oid from pg_class c join pg_attribute x on x.attrelid=c.oid and x.attname='conference_id')`);
   assert.ok(fkCols.length>0);
   const rule=deletes.find(r=>r.tbl===tbl)!;
   for(const {col} of fkCols)assert.ok(rule.scope.includes(`t.${col} in`),`${tbl}.${col} must be in the scope`);
  }
  assert.equal(deletes.find(r=>r.tbl==='public.conferences')!.seq,Math.max(...rules.map(r=>r.seq)),'the conference row is deleted last');
 }finally{await d.db.close();}
});

test('the rule order is foreign-key safe: every child is deleted before its parent (the one cycle is broken by the pre-step)',async()=>{
 const {d,rules,q}=await load();
 try{
  const deleteSeq=new Map(rules.filter(r=>r.kind==='delete').map(r=>[r.tbl,r.seq]));
  const update=rules.find(r=>r.kind==='update')!;
  const fks=await q<{child:string;parent:string;col:string;name:string}>(`select format('%I.%I',cn.nspname,cc.relname) child, format('%I.%I',pn.nspname,pc.relname) parent, a.attname col, k.conname name
    from pg_constraint k join pg_class cc on cc.oid=k.conrelid join pg_namespace cn on cn.oid=cc.relnamespace join pg_class pc on pc.oid=k.confrelid join pg_namespace pn on pn.oid=pc.relnamespace join pg_attribute a on a.attrelid=k.conrelid and a.attnum=k.conkey[1]
    where k.contype='f' and cn.nspname in('public','private') and pn.nspname in('public','private') order by 1,2`);
  assert.ok(fks.length>100,'the schema has the expected foreign keys');
  const cycles:string[]=[];
  for(const fk of fks){
   if(fk.child===fk.parent)continue;                        // self-references are satisfied within one statement
   const child=deleteSeq.get(fk.child)!,parent=deleteSeq.get(fk.parent)!;
   assert.ok(child!==undefined&&parent!==undefined,`${fk.name}: both ends need delete rules`);
   if(child<parent)continue;
   // Only allowed when the child's column is detached by the pre-step BEFORE the parent is deleted.
   const detached=fk.child===update.tbl&&update.setsql!.includes(`"${fk.col}"`)&&update.seq<parent;
   if(!detached)cycles.push(`${fk.child}.${fk.col} -> ${fk.parent}: child step ${child} is not before parent step ${parent}`);
  }
  assert.deepEqual(cycles,[]);
  // The pre-step only nulls a column, so it has to run before sessions are deleted.
  assert.ok(update.seq<deleteSeq.get('public.sessions')!);
 }finally{await d.db.close();}
});

test('the coverage check fails when a new conference-scoped table is added without a rule (self-test of the guard)',async()=>{
 const {d,rules,q}=await load();
 try{
  assert.deepEqual((await uncovered(q,rules)).missing,[]);
  await d.db.exec('create table public.future_scoped(id uuid primary key, conference_id uuid not null references public.conferences(id)); create table private.future_secret(x int);');
  assert.deepEqual((await uncovered(q,rules)).missing,['private.future_secret','public.future_scoped']);
  await d.db.exec('drop table public.future_scoped; drop table private.future_secret; alter table public.timers rename to timers_renamed;');
  const r=await uncovered(q,rules);
  assert.deepEqual(r.missing,['public.timers_renamed']);assert.deepEqual(r.stale,['public.timers']);
 }finally{await d.db.close();}
});

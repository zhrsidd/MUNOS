// Guarded DELETION of synthetic / temporary conferences (lifecycle cutover step 2; checklist 1.9.5 and 2.2).
// docs/SYNTHETIC_CLEANUP.md is the procedure. The revoke-only fixture cleanup.sql must already have been applied.
//
//   DEFAULT = DRY RUN. It changes nothing (the transaction is read only and rolled back), prints per-table row counts, the Storage
//   keys and the Auth users, and a CONFIRMATION TOKEN: a SHA-256 over the project, the exact id list, the conference names and
//   every table's count and content fingerprint. Executing needs --execute AND that token, so the delete cannot run on stale or
//   different input.
//
//   npm run cleanup:synthetic -- --conference <uuid> [--conference <uuid> ...]                      # dry run
//   npm run cleanup:synthetic -- --conference <uuid> ... --execute --token <64 hex> \
//        --backup-evidence "<where the backup/PITR state was recorded>" --owner-approval "<where the owner approved>"
//
// Needs, in .env.local (read exactly like scripts/remote-context.mts): NEXT_PUBLIC_SUPABASE_URL, a project listed in
// STAGING_SUPABASE_REFS or DEVELOPMENT_SUPABASE_REFS, NEXT_PUBLIC_CONFERENCE_ID (protected, required), optionally
// PROTECTED_CONFERENCE_IDS, and SUPABASE_DB_URL (a direct or session-pooler Postgres URL for the SAME project; never printed).
//
// *** RUNNING THIS AGAINST THE HOSTED PROJECT NEEDS THE OWNER'S SEPARATE APPROVAL. Preparing and testing it does not, and no
// *** cloud agent runs it. The tool refuses production-classified refs, refs not on the allow-list and any database URL whose ref
// *** differs from the guarded NEXT_PUBLIC_SUPABASE_URL. Deletion is IRREVERSIBLE: record the backup/PITR state first.
// *** Storage objects are never deleted here; the keys are listed for the separate, human-confirmed step.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertToolTarget} from '../lib/platform/target-guard';
import {PsqlRunner,CleanupError,TOKEN,buildScript,checkLocalDatabaseUrl,checkProtected,databaseUrlRef,parseConferenceIds,parseReport,type Report} from './cleanup/engine';

const refuse=(reason:string):never=>{console.error(`Refused: ${reason}. Nothing was contacted.`);process.exit(2);};
const argv=process.argv.slice(2);
const flags=new Set(['--conference','--conferences','--execute','--token','--backup-evidence','--owner-approval','--out','--local-url','--help']);
const values=new Map<string,string[]>();let execute=false;
for(let i=0;i<argv.length;i++){
 const a=argv[i];
 if(!flags.has(a))refuse(`unknown argument ${a.startsWith('--')?a:'(positional arguments are not accepted)'}`);
 if(a==='--help'){console.log('See the header of scripts/cleanup-synthetic.mts and docs/SYNTHETIC_CLEANUP.md.');process.exit(0);}
 if(a==='--execute'){execute=true;continue;}
 const v=argv[++i];if(v===undefined||v.startsWith('--'))refuse(`${a} needs a value`);
 values.set(a,[...(values.get(a)??[]),v]);
}
const one=(flag:string)=>{const v=values.get(flag);if(v&&v.length>1)refuse(`${flag} was given more than once`);return v?.[0];};

// 1. The explicit id list.
const parsed=parseConferenceIds([...(values.get('--conference')??[]),...(values.get('--conferences')??[])]);
if(!parsed.ok)refuse(parsed.reason);
const ids=(parsed as {ids:string[]}).ids;

// 2. Configuration: .env.local, parsed exactly like scripts/remote-context.mts.
let env:Record<string,string>;
try{env=Object.fromEntries((await readFile('.env.local','utf8')).split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));}
catch{refuse('.env.local could not be read');env={};}
const merged={...env,...process.env} as Record<string,string|undefined>;

// 3. The target. Hosted: the target guard on the FILE url (allow-list; production-classified and unlisted refs refused), then the
//    database URL must name that same project. Local (tests only): loopback and a munos_test_*/munos_local_* database.
let label:string,dbUrl:string;
const local=one('--local-url');
if(local!==undefined){
 const c=checkLocalDatabaseUrl(local);if(!c.ok)refuse((c as {reason:string}).reason);
 label='local';dbUrl=local;
}else{
 let ref='';
 try{ref=assertToolTarget(env.NEXT_PUBLIC_SUPABASE_URL,merged);}catch(error){refuse((error as Error).message.replace(/^Target guard refused: /,'').replace(/\. Nothing was contacted\.$/,''));}
 const url=merged.SUPABASE_DB_URL;
 if(!url)refuse('SUPABASE_DB_URL is not set (a Postgres URL for the guarded project, kept in .env.local)');
 const dbRef=databaseUrlRef(url);
 if(!dbRef)refuse('SUPABASE_DB_URL is not a Supabase Postgres URL (db.<ref>.supabase.co, or postgres.<ref> on a pooler host)');
 if(dbRef!==ref)refuse(`SUPABASE_DB_URL names project ${dbRef}, not the guarded project ${ref}`);
 label=ref;dbUrl=url!;
}

// 4. Protected conferences (NEXT_PUBLIC_CONFERENCE_ID is required: fail closed).
const prot=checkProtected(ids,merged);
if(!prot.ok)refuse((prot as {reason:string}).reason);
const protectedIds=(prot as {protectedIds:string[]}).protectedIds;

// 5. Execute needs the token and the recorded approvals.
const token=one('--token'),backup=one('--backup-evidence')?.trim(),approval=one('--owner-approval')?.trim();
if(!execute&&(token||backup||approval))refuse('--token, --backup-evidence and --owner-approval apply only with --execute (the default is a dry run)');
if(execute){
 if(!token||!TOKEN.test(token))refuse('--execute needs --token <64 hex> from a dry run of exactly these ids');
 if(!backup)refuse('--execute needs --backup-evidence "<where the backup/PITR state was recorded>"; deletion is irreversible');
 if(!approval)refuse('--execute needs --owner-approval "<where the owner approved this run>"');
}

// 6. Run. Only now is a database connection attempted.
const dir=fileURLToPath(new URL('./cleanup/',import.meta.url));
const script=await buildScript(dir,{mode:execute?'execute':'dry-run',label,ids,protectedIds,token});
let report:Report;
try{report=parseReport(await new PsqlRunner(dbUrl).run(script));}
catch(error){
 const message=(error as Error).message;
 if(error instanceof CleanupError&&/REFUSED/.test(message)){console.error(`Refused: ${message.replace(/^.*?REFUSED:\s*/,'')}`);process.exit(2);}
 console.error(`Failed: ${message}. The transaction was rolled back; nothing was deleted.`);process.exit(1);
}

// 7. Output and evidence (no secrets: the report holds counts, names, ids and storage paths only).
const out=one('--out')??join('.test-sessions','cleanup',`${new Date().toISOString().replace(/[:.]/g,'-')}-${label}`);
await mkdir(out,{recursive:true,mode:0o700});
const file=execute?'execute-audit.json':'dry-run.json';
await writeFile(join(out,file),JSON.stringify({...report,operator:execute?{backup_evidence:backup,owner_approval:approval}:undefined,requested_ids:ids},null,2),{mode:0o600});
const keys=[...report.storage.document_version_keys.map(k=>`resolutions-db\t${k}`),...report.storage.bucket_objects.map(o=>`${o.bucket}\t${o.key}`)];
if(keys.length)await writeFile(join(out,'storage-keys.txt'),keys.join('\n')+'\n',{mode:0o600});
if(report.auth_user_candidates.length)await writeFile(join(out,'auth-user-candidates.txt'),report.auth_user_candidates.join('\n')+'\n',{mode:0o600});

console.log(`${execute?'EXECUTED':'DRY RUN (nothing changed)'} against ${label}: ${report.status}`);
for(const c of report.conferences)console.log(`  conference ${c.id}  "${c.name}"`);
for(const t of report.tables)if((t.rows??t.affected??0)>0)console.log(`  ${String(t.seq).padStart(2)} ${t.table.padEnd(36)} ${t.kind==='update'?'update':'delete'} ${execute?`${t.affected} (expected ${t.expected})`:t.rows}`);
console.log(`  total rows ${execute?'deleted':'that execution would delete'}: ${execute?report.total_rows_deleted:report.total_rows_deleted_if_executed}`);
console.log(`  storage objects to remove by hand: ${keys.length}   auth users that only these conferences reference: ${report.auth_user_candidates.length}`);
console.log(`  evidence: ${join(out,file)}`);
if(!execute&&report.status==='ready')console.log(`\nConfirmation token (bound to ${label}, these ids and these counts):\n  ${report.token}\nReview the counts, record the backup/PITR state, obtain the owner's approval, then re-run with --execute --token <token> --backup-evidence ... --owner-approval ...`);
if(execute)console.log('\nStorage objects and Auth users were NOT deleted. Do the separate, listed, human-confirmed steps in docs/SYNTHETIC_CLEANUP.md, then run the dry run again (expect nothing_to_delete and zero storage objects).');

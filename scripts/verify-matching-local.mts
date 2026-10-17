import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import type {PGlite} from '../test-results/sql-review/node_modules/@electric-sql/pglite/dist/index.js';
export async function verifyMatching(db:PGlite,ids:{staff:string;owner:string}){
 const checks:string[]=[],q=async(s:string,a:unknown[]=[])=> (await db.query(s,a)).rows as Record<string,unknown>[],scalar=async(s:string,a:unknown[]=[])=> (await q(s,a))[0].result;
 const reject=async(s:string,a:unknown[]=[],code='P0001')=>{try{await db.query(s,a);assert.fail('Expected rejection');}catch(e){assert.equal((e as {code?:string}).code,code);}},pass=(s:string)=>{checks.push(s);console.log('PASS 0014: '+s);};
 const sql=await readFile('supabase/migrations/202610040014_employer_matching.sql','utf8');await db.exec('reset role');
 const old=(await q("select tablename from pg_tables where schemaname='public' order by tablename")).map(r=>r.tablename);
 async function snapshot(){const rows=[];for(const t of old){const added=t==='employers'?['revision']:t==='employer_opportunities'?['revision','recipient_email']:t==='application_matches'?['revision','consent_state','consent_scope','consent_principal_id']:[];rows.push(await q(`select to_jsonb(t)-$1::text[] as row from public.${t} t order by (to_jsonb(t)-$1::text[])::text`,[added]));}return JSON.stringify(rows);}
 const before=await snapshot();try{await db.exec(sql.replace(/commit;\s*$/,'select 1/0; commit;'));assert.fail();}catch(e){assert.equal((e as {code?:string}).code,'22012');await db.exec('rollback');}await db.exec(sql);assert.equal(await snapshot(),before);
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);for(const call of ['manage_matching(null,null,null,null)','decide_portal_match_consent(null,null,null,null,null)','load_portal_matches(null)'])await reject('select public.'+call,[],'42501');await db.exec('reset role');}
 await reject('select public.manage_matching($1,$2,$3,$4)',[randomUUID(),ids.owner,'employer_save',{id:randomUUID(),revision:0,name:'Invalid actor',website:'https://example.invalid'}]);
 const invoke=(operation:string,data:Record<string,unknown>,key=randomUUID())=>scalar('select public.manage_matching($1,$2,$3,$4) as result',[key,ids.staff,operation,data]);
 const employer=randomUUID(),opportunity=randomUUID(),match=randomUUID(),command=randomUUID();const employerData={id:employer,revision:0,name:'Local fixture employer',website:'https://example.invalid'};
 assert.equal((await invoke('employer_save',employerData,command) as {revision:number}).revision,1);assert.equal((await invoke('employer_save',employerData,command) as {replayed:boolean}).replayed,true);
 await reject('select public.manage_matching($1,$2,$3,$4)',[command,ids.staff,'employer_save',{...employerData,name:'Changed retry'}]);
 const opportunityData={id:opportunity,revision:0,employerId:employer,title:'Local authorized role',sourceUrl:'https://example.invalid/role',checkedAt:new Date(Date.now()-10000).toISOString(),status:'verified',authorized:true,evidence:'Local fixture authorization evidence only.',recipient:'hiring@example.invalid'};
 await invoke('opportunity_save',opportunityData);
 const app=(await q("select a.* from public.applications a join public.payments p on p.id=(select payment_id from public.vouchers where id=a.voucher_id) where p.customer_email='response@example.invalid'"))[0];assert.ok(app);
 const create={id:match,revision:0,applicationId:app.id,opportunityId:opportunity,message:'A proposed employer match for internal review.'};
 await reject('select public.manage_matching($1,$2,$3,$4)',[randomUUID(),ids.staff,'match_create',create]);
 // This is an isolated local fixture, not the original hosted application.
 await q("update public.applications set status='accepted' where id=$1",[app.id]);await invoke('match_create',create);
 await invoke('match_status',{id:match,revision:1,status:'qualified',message:'CruiseApply qualification recorded.'});await invoke('match_status',{id:match,revision:2,status:'shortlisted',message:'Shortlisted for this authorized employer opportunity.'});
 const access=(await q('select * from public.voucher_access where voucher_id=$1',[app.voucher_id]))[0],voucher=(await q('select serial from public.vouchers where id=$1',[app.voucher_id]))[0],token=randomBytes(32).toString('hex');
 await q('select * from public.open_verified_voucher_session($1,$2,$3,$4)',[voucher.serial,access.pin_hash,access.credential_version,token]);assert.deepEqual(await scalar('select public.load_portal_matches($1) as result',[token]),[]);
 const doc=(await q('select id from public.application_documents where application_id=$1 limit 1',[app.id]))[0];
 await reject('select public.manage_matching($1,$2,$3,$4)',[randomUUID(),ids.staff,'consent_request',{id:match,revision:3,message:'Please review this sharing request.',documentIds:[randomUUID()]}]);
 await invoke('consent_request',{id:match,revision:3,message:'Please review this employer-specific consent request.',documentIds:[doc.id]});
 const visible=await scalar('select public.load_portal_matches($1) as result',[token]) as {scope:Record<string,unknown>}[];assert.equal(visible.length,1);assert.equal(visible[0].scope.recipient,'hiring@example.invalid');assert.ok(!JSON.stringify(visible).includes('authorization_evidence'));
 await reject('select public.manage_matching($1,$2,$3,$4)',[randomUUID(),ids.staff,'referral_record',{id:match,revision:4,message:'A completed referral was recorded.',evidence:'Local evidence without actual data transmission.'}]);
 const consent=randomUUID();assert.equal((await scalar('select public.decide_portal_match_consent($1,$2,4,$3,$4) as result',[token,match,consent,'granted']) as {revision:number}).revision,5);assert.equal((await scalar('select public.decide_portal_match_consent($1,$2,4,$3,$4) as result',[token,match,consent,'granted']) as {replayed:boolean}).replayed,true);
 await reject('select public.decide_portal_match_consent($1,$2,4,$3,$4)',[token,match,consent,'declined']);
 // A changed employer snapshot invalidates old consent, including referral recording.
 await invoke('employer_save',{...employerData,revision:1,name:'Updated local employer'});
 await reject('select public.manage_matching($1,$2,$3,$4)',[randomUUID(),ids.staff,'referral_record',{id:match,revision:5,message:'A completed referral was recorded.',evidence:'Local evidence without actual data transmission.'}]);
 await invoke('consent_request',{id:match,revision:5,message:'Review the updated employer consent request.',documentIds:[]});
 await scalar('select public.decide_portal_match_consent($1,$2,6,$3,$4) as result',[token,match,randomUUID(),'granted']);
 const referral=randomUUID(),referralData={id:match,revision:7,message:'CruiseApply recorded the authorized referral. This is not an employment offer.',evidence:'Local test record only; no data was transmitted.'};await invoke('referral_record',referralData,referral);assert.equal((await invoke('referral_record',referralData,referral) as {replayed:boolean}).replayed,true);
 await scalar('select public.decide_portal_match_consent($1,$2,8,$3,$4) as result',[token,match,randomUUID(),'revoked']);await invoke('match_status',{id:match,revision:9,status:'closed',message:'The employer match has been closed.'});
 assert.equal(await scalar('select status as result from public.applications where id=$1',[app.id]),'accepted');
 for(const event of await q("select metadata from public.audit_logs where target_id=$1",[match]))assert.ok(!JSON.stringify(event.metadata).includes('evidence'));
 await db.exec('set role anon');await reject('select * from public.matching_commands',[],'42501');await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[ids.owner]);await db.exec('set role authenticated');assert.equal((await q('select * from public.application_matches')).length,0);assert.equal((await q('select * from public.matching_commands')).length,0);await db.exec('reset role');
 pass('Atomic install/rollback, staff authorization, retry payload/revision checks, qualified-only matching, exact employer/document consent, stale consent denial, referral record, revocation and staff RLS pass; no transmission');
 const catalog=(await q(await readFile('supabase/configuration/verify-0014-readonly.sql','utf8')))[0].verification_0014;
 await writeFile('test-results/employer-matching-0014-local-catalog.json',JSON.stringify(catalog,null,2));await writeFile('test-results/employer-matching-0014-local.json',JSON.stringify({passed:true,sqlSha256:createHash('sha256').update(sql).digest('hex'),checks,hosted:false,externalTransmission:false},null,2));
}

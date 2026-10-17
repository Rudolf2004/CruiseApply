import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import type {PGlite} from '../test-results/sql-review/node_modules/@electric-sql/pglite/dist/index.js';
export async function verifyApplicantActions(db:PGlite,ids:{owner:string;staff:string;job:string;product:string}){
 const checks:string[]=[],q=async(s:string,a:unknown[]=[])=> (await db.query(s,a)).rows as Record<string,unknown>[],scalar=async(s:string,a:unknown[]=[])=> (await q(s,a))[0].result;
 const hash=()=>randomBytes(32).toString('hex'),reject=async(s:string,a:unknown[]=[],code='P0001')=>{try{await db.query(s,a);assert.fail('Expected rejection');}catch(e){assert.equal((e as {code?:string}).code,code);}};
 const pass=(s:string)=>{checks.push(s);console.log('PASS 0013: '+s);};
 await db.exec('reset role');const tables=(await q("select tablename from pg_tables where schemaname='public' order by tablename")).map(r=>r.tablename);
 async function snapshot(){const out=[];for(const t of tables)out.push(await q(`select to_jsonb(t) as row from public.${t} t order by to_jsonb(t)::text`));return JSON.stringify(out);}
 const before=await snapshot(),sql=await readFile('supabase/migrations/202610040013_applicant_responses_withdrawal.sql','utf8');
 try{await db.exec(sql.replace(/commit;\s*$/,'select 1/0; commit;'));assert.fail();}catch(e){assert.equal((e as {code?:string}).code,'22012');await db.exec('rollback');}assert.equal(await snapshot(),before);assert.equal(await scalar("select to_regclass('public.application_applicant_commands') as result"),null);
 await db.exec(sql);assert.equal(await snapshot(),before);pass('Exact migration executes and injected late failure rolls back without business-row changes');
 const calls=['portal_response_upload_context(null,null,null,null,null)','submit_portal_response(null,null,null,null,null,null)','withdraw_portal_application(null,null,null,null,null)','load_portal_responses(null,null,1)'];
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);for(const call of calls)await reject('select public.'+call,[],'42501');await db.exec('reset role');}
 const cap=hash(),token=hash(),pin='s1:'+randomBytes(16).toString('hex')+':'+hash(),ref='CA-'+randomUUID();
 await scalar('select public.begin_guest_checkout($1,$2,$3,$4) as result',[cap,'response@example.invalid','Response fixture','GH']);
 const quote=await scalar('select public.create_guest_quote($1,$2) as result',[cap,ids.product]) as {id:string};await scalar('select public.create_guest_payment($1,$2,$3,null) as result',[cap,quote.id,ref]);await scalar("select public.fulfill_verified_payment($1,15000,'GHS','response@example.invalid','local-response',null,null) as result",[ref]);
 await scalar('select public.claim_guest_voucher($1,$2,$3) as result',[cap,pin,token]);const app=await scalar('select public.redeem_portal_voucher($1,$2) as result',[token,ids.job]);
 const draft={personal:{first_name:'Local',surname:'Applicant',date_of_birth:'1995-01-01',nationality:'Ghanaian',country_of_residence:'GH',email:'response@example.invalid',phone:'+233200000000',address:'Local test'},identification:{},education:[],experience:[],answers:{}};
 await scalar('select public.save_portal_application($1,$2,0,$3) as result',[token,app,draft]);await scalar('select public.submit_portal_application($1,$2,1,true) as result',[token,app]);
 await scalar("select public.review_application($1,$2,$3,2,'under_review','CruiseApply internal review.') as result",[randomUUID(),ids.staff,app]);
 await scalar("select public.review_application($1,$2,$3,3,'additional_information_required','Please provide supporting information through your applicant portal.') as result",[randomUUID(),ids.staff,app]);
 const request=randomUUID(),doc=randomUUID(),body='My additional information remains private to my own application.';
 await reject('select public.portal_response_upload_context($1,$2,4,$3,$4)',[hash(),app,request,doc],'28000');await reject('select public.portal_response_upload_context($1,$2,4,$3,$4)',[token,randomUUID(),request,doc]);await reject('select public.portal_response_upload_context($1,$2,3,$3,$4)',[token,app,request,doc]);
 const path=await scalar('select public.portal_response_upload_context($1,$2,4,$3,$4) as result',[token,app,request,doc]);const docs=[{id:doc,name:'support.pdf',mime:'application/pdf',size:24}];
 await reject('select public.submit_portal_response($1,$2,4,$3,$4,$5)',[token,app,request,body,docs]);await q("insert into storage.objects(bucket_id,name,metadata) values('application-documents',$1,'{\"mimetype\":\"application/pdf\",\"size\":24}')",[path]);
 await reject('select public.submit_portal_response($1,$2,4,$3,$4,$5)',[token,app,request,body,[{...docs[0],size:25}]]);
 const stored=(await q('select personal,identification,submitted_at,declaration_at from public.applications where id=$1',[app]))[0];
 await db.exec('set role service_role');await reject('select public.guard_applicant_command()',[],'42501');
 const result=await scalar('select public.submit_portal_response($1,$2,4,$3,$4,$5) as result',[token,app,request,body,docs]);assert.deepEqual(result,{revision:5,status:'under_review',replayed:false});
 const replay=await scalar('select public.submit_portal_response($1,$2,4,$3,$4,$5) as result',[token,app,request,body,docs]);assert.deepEqual(replay,{revision:5,status:'under_review',replayed:true});await reject('select public.submit_portal_response($1,$2,4,$3,$4,$5)',[token,app,request,body+'changed',docs]);
 assert.deepEqual((await q('select personal,identification,submitted_at,declaration_at from public.applications where id=$1',[app]))[0],stored);
 assert.equal(await scalar("select count(*)::int as result from public.notifications where title='Response received' and applicant_id=(select applicant_id from public.applications where id=$1)",[app]),1);
 assert.equal(await scalar("select count(*)::int as result from public.audit_logs where action='applicant_response_submitted' and target_id=$1",[app]),1);
 assert.equal((await scalar('select public.authorize_portal_document($1,$2,$3) as result',[token,app,doc]) as {storage_path:string}).storage_path,path);
 assert.equal((await scalar('select public.load_portal_responses($1,$2,1) as result',[token,app]) as {total:number}).total,1);
 await reject('update public.application_applicant_commands set body=$1 where request_id=$2',['Rewritten response',request],'42501');await db.exec('reset role');await reject('update public.application_applicant_commands set body=$1 where request_id=$2',['Rewritten response',request]);
 pass('Session/application/revision/upload scope, original-submission immutability, reply idempotency, one notification/audit and scoped private document access pass');
 await db.exec('set role anon');await reject('select * from public.application_applicant_commands',[],'42501');await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[ids.owner]);await db.exec('set role authenticated');assert.equal((await q('select * from public.application_applicant_commands')).length,0);await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[ids.staff]);await db.exec('set role authenticated');assert.equal((await q('select * from public.application_applicant_commands')).length,1);await db.exec('reset role');
 const withdraw=randomUUID(),reason='I am withdrawing my own application for personal reasons.';
 await reject('select public.withdraw_portal_application($1,$2,4,$3,$4)',[token,app,withdraw,reason]);await scalar('select public.withdraw_portal_application($1,$2,5,$3,$4) as result',[token,app,withdraw,reason]);
 assert.equal((await scalar('select public.withdraw_portal_application($1,$2,5,$3,$4) as result',[token,app,withdraw,reason]) as {replayed:boolean}).replayed,true);
 await reject('select public.withdraw_portal_application($1,$2,5,$3,$4)',[token,app,withdraw,reason+' changed']);await reject('select public.withdraw_portal_application($1,$2,6,$3,$4)',[token,app,randomUUID(),reason]);
 await reject("select public.review_application($1,$2,$3,6,'under_review','Try to reopen terminal application.')",[randomUUID(),ids.staff,app]);await reject('select public.submit_portal_response($1,$2,6,$3,$4,$5)',[token,app,randomUUID(),body,[]]);
 assert.equal((await scalar('select public.load_voucher_portal($1,1) as result',[token]) as {application:{status:string}}).application.status,'withdrawn');
 assert.equal(await scalar("select count(*)::int as result from public.audit_logs where action='application_withdrawn_by_applicant' and target_id=$1",[app]),1);
 for(const r of await q("select metadata from public.audit_logs where target_id=$1 and action in ('application_withdrawn_by_applicant','applicant_response_submitted')",[app])){const m=JSON.stringify(r.metadata);assert.ok(!m.includes(body)&&!m.includes(reason)&&!m.includes('support.pdf'));}
 pass('Anon/applicant table isolation and staff RLS reads, explicit withdrawal, retry/conflict/terminal protections, read tracking after withdrawal and body-free audits pass');
 const catalog=(await q(await readFile('supabase/configuration/verify-0013-readonly.sql','utf8')))[0].verification_0013 as {functions:{exists:boolean;service_callable:boolean;service_execute:boolean;anon_execute:boolean;authenticated_execute:boolean;public_execute:boolean}[]};
 assert.equal(catalog.functions.length,5);for(const f of catalog.functions){assert.equal(f.exists,true);assert.equal(f.service_execute,f.service_callable);assert.equal(f.anon_execute,false);assert.equal(f.authenticated_execute,false);assert.equal(f.public_execute,false);}
 await writeFile('test-results/applicant-actions-0013-local-catalog.json',JSON.stringify(catalog,null,2));await writeFile('test-results/applicant-actions-0013-local.json',JSON.stringify({passed:true,sqlSha256:createHash('sha256').update(sql).digest('hex'),checks,hosted:false},null,2));
}

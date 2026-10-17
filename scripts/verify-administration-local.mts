import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import type {PGlite} from '../test-results/sql-review/node_modules/@electric-sql/pglite/dist/index.js';
export async function verifyAdministration(db:PGlite,ids:{staff:string;owner:string;product:string}){
 const q=async(s:string,p:unknown[]=[])=> (await db.query(s,p)).rows as Record<string,unknown>[],sql=await readFile('supabase/migrations/202610100015_administration_controls.sql','utf8');
 const reject=async(s:string,p:unknown[]=[],code='P0001')=>{try{await db.query(s,p);assert.fail('Expected failure');}catch(e){assert.equal((e as {code?:string}).code,code);}};
 const tables=(await q("select tablename from pg_tables where schemaname='public' order by tablename")).map(r=>r.tablename);
 async function snapshot(){const out=[];for(const t of tables)out.push(await q(`select to_jsonb(t)-$1::text[] as row from public.${t} t order by (to_jsonb(t)-$1::text[])::text`,[t==='jobs'||t==='voucher_types'?['admin_revision']:[]]));return JSON.stringify(out);}
 await db.exec('reset role');const before=await snapshot();try{await db.exec(sql.replace(/commit;\s*$/,'select 1/0;commit;'));assert.fail();}catch(e){assert.equal((e as {code?:string}).code,'22012');await db.exec('rollback');}await db.exec(sql);assert.equal(await snapshot(),before);
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await reject('select public.save_administration_record(null,null,null,null)',[],'42501');await db.exec('reset role');}
 const call=async(actor:string,operation:string,data:unknown,key=randomUUID())=>(await q('select public.save_administration_record($1,$2,$3,$4) as result',[key,actor,operation,data]))[0].result as Record<string,unknown>;
 const data={id:randomUUID(),revision:0,title:'Local managed intake',slug:'local-'+randomUUID(),category:'Hospitality',department:'Guest Services',location:'Worldwide',summary:'Local test managed screening category.',description:'Local test description of candidate screening services.',serviceDescription:'CruiseApply screens candidate applications. No employment or referral is guaranteed.',status:'draft',requiredDocuments:[],questions:[]};
 await reject('select public.save_administration_record($1,$2,$3,$4)',[randomUUID(),ids.owner,'intake_save',data]);
 const key=randomUUID();assert.equal((await call(ids.staff,'intake_save',data,key)).revision,1);assert.equal((await call(ids.staff,'intake_save',data,key)).replayed,true);
 await reject('select public.save_administration_record($1,$2,$3,$4)',[key,ids.staff,'intake_save',{...data,title:'Conflicting retry'}]);
 await reject('select public.save_administration_record($1,$2,$3,$4)',[randomUUID(),ids.staff,'intake_save',data]);
 await call(ids.staff,'intake_save',{...data,revision:1,status:'published'});
 await reject('select public.save_administration_record($1,$2,$3,$4)',[randomUUID(),ids.staff,'intake_save',{...data,revision:2,company:'Invented employer'}]);
 await reject('select public.save_administration_record($1,$2,$3,$4)',[randomUUID(),ids.staff,'intake_save',{...data,revision:2,questions:[{id:'same',label:'First',required:false},{id:'same',label:'Second',required:false}]}]);
 const existing=(await q("select j.* from public.jobs j where exists(select 1 from public.applications a where a.job_id=j.id) and opportunity_type='managed' and company is null and not sample limit 1"))[0];assert.ok(existing);
 const existingData={...data,id:existing.id,revision:0,title:existing.title,slug:existing.slug,category:existing.category,department:existing.department,summary:existing.summary,description:existing.description,serviceDescription:existing.service_description,location:existing.location,status:'paused',questions:existing.questions,requiredDocuments:existing.required_documents};
 await reject('select public.save_administration_record($1,$2,$3,$4)',[randomUUID(),ids.staff,'intake_save',{...existingData,title:'Changed existing contract'}]);await call(ids.staff,'intake_save',existingData);
 const pricing={id:ids.product,revision:0,name:'Local voucher',description:'Local screening access product.',amount:15000,validityDays:90,active:true};
 await reject('select public.save_administration_record($1,$2,$3,$4)',[randomUUID(),ids.staff,'product_save',pricing]);
 await q("update public.profiles set role='super_admin' where id=$1",[ids.staff]);await call(ids.staff,'product_save',pricing);
 await reject('select public.save_administration_record($1,$2,$3,$4)',[randomUUID(),ids.staff,'product_save',{...pricing,revision:1,currency:'USD'}]);
 await q("select set_config('request.jwt.claim.sub',$1,false)",[ids.owner]);await db.exec('set role authenticated');assert.equal((await q('select * from public.administration_commands')).length,0);await db.exec('reset role');
 await q("select set_config('request.jwt.claim.sub',$1,false)",[ids.staff]);await db.exec('set role authenticated');assert.ok((await q('select * from public.administration_commands')).length>=4);await reject("update public.administration_commands set payload='{}'",[],'42501');await db.exec('reset role');
 const audits=await q("select metadata from public.audit_logs where action in ('intake_save','product_save')");assert.ok(audits.length>=4);assert.ok(audits.every(r=>!JSON.stringify(r.metadata).includes('description')));
 const catalog=(await q(await readFile('supabase/configuration/verify-0015-readonly.sql','utf8')))[0].verification_0015;
 await writeFile('test-results/administration-0015-local-catalog.json',JSON.stringify(catalog,null,2));await writeFile('test-results/administration-0015-local.json',JSON.stringify({passed:true,sqlSha256:createHash('sha256').update(sql).digest('hex'),checks:['Atomic rollback and existing-row preservation','Service-only RPC and non-staff denial','Idempotent retry, conflict and stale revision rejection','Managed intake fields/questions validation and protection of existing application contracts','Super-admin-only GHS product update','Staff-only command RLS and body-free audit attribution'],limitations:['Single local connection; hosted concurrency pending manual application'],hosted:false},null,2));console.log('PASS 0015: administration SQL, rollback, authorization, retries, stale revisions, contract preservation, RLS and audit checks');
}

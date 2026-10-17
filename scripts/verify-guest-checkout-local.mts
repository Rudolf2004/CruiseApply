import assert from 'node:assert/strict';
import { randomBytes,randomUUID,createHash } from 'node:crypto';
import { readFile,writeFile } from 'node:fs/promises';
import type { PGlite } from '../test-results/sql-review/node_modules/@electric-sql/pglite/dist/index.js';
export async function verifyGuestStage(db:PGlite,ids:{owner:string;staff:string;job:string;product:string;voucher:string}){
  const checks:string[]=[],q=async(sql:string,args:unknown[]=[]) => (await db.query(sql,args)).rows as Record<string,unknown>[];
  const scalar=async(sql:string,args:unknown[]=[]) => (await q(sql,args))[0].result;
  const digest=()=>randomBytes(32).toString('hex'),pinHash='s1:'+randomBytes(16).toString('hex')+':'+randomBytes(32).toString('hex');
  const pass=(s:string)=>{checks.push(s);console.log('PASS 0011: '+s);};
  async function reject(sql:string,args:unknown[]=[],code='P0001'){try{await db.query(sql,args);assert.fail('Expected rejection');}catch(e){assert.equal((e as {code?:string}).code,code);}}
  const tables=(await q("select tablename from pg_tables where schemaname='public' order by tablename")).map(r=>String(r.tablename));
  async function snapshot(){const rows=[];for(const t of tables)rows.push(await q(`select to_jsonb(t) as row from public.${t} t order by to_jsonb(t)::text`));return createHash('sha256').update(JSON.stringify(rows)).digest('hex');}
  const sql=await readFile('supabase/migrations/202610030011_guest_checkout_claim.sql','utf8'),before=await snapshot();
  const policyQuery="select * from pg_policies order by schemaname,tablename,policyname",policies=await q(policyQuery);
  try{await db.exec(sql.replace(/commit;\s*$/,'select 1/0;\ncommit;'));assert.fail('Expected rollback');}catch(e){assert.equal((e as {code?:string}).code,'22012');await db.exec('rollback');}
  assert.equal(await snapshot(),before);assert.equal(await scalar("select is_nullable as result from information_schema.columns where table_schema='public' and table_name='payments' and column_name='user_id'"),'NO');
  await db.exec(sql);assert.equal(await snapshot(),before);assert.deepEqual(await q(policyQuery),policies);
  pass('Exact 0011 executes; late failure rolls back; existing records and all RLS policies unchanged');
  const catalog=(await q(await readFile('supabase/configuration/verify-0011-readonly.sql','utf8')))[0].verification_0011 as {functions:{exists:boolean;service_callable:boolean;service_execute:boolean;anon_execute:boolean;authenticated_execute:boolean;public_execute:boolean;security_definer:boolean;signature:string}[]};
  assert.equal(catalog.functions.length,22);
  for(const f of catalog.functions){assert.equal(f.exists,true,f.signature);assert.equal(f.service_execute,f.service_callable,f.signature);assert.equal(f.anon_execute,false);assert.equal(f.authenticated_execute,false);assert.equal(f.public_execute,false);}
  await writeFile('test-results/guest-checkout-0011-local-catalog.json',JSON.stringify(catalog,null,2));
  const calls=["begin_guest_checkout(null,null,null,null)","create_guest_quote(null,null)","create_guest_payment(null,null,null,null)","get_guest_checkout(null)","claim_guest_voucher(null,null,null)"];
  for(const role of ['anon','authenticated']){await db.exec('set role '+role);for(const call of calls)await reject('select public.'+call,[],'42501');await db.exec('reset role');}
  await db.exec('set role service_role');await reject('select public.lock_guest_checkout(null)',[],'42501');await reject('select public.save_application_draft_principal(null,null,0,null)',[],'42501');
  await reject('select public.begin_guest_checkout($1,$2,$3,$4)',['raw-capability','guest@example.invalid','Guest','GH']);
  const cap=digest();const checkout=await scalar('select public.begin_guest_checkout($1,$2,$3,$4) as result',[cap,'guest@example.invalid','Guest applicant','GH']);
  const quote=await scalar('select public.create_guest_quote($1,$2) as result',[cap,ids.product]) as Record<string,unknown>;assert.equal(quote.charge_currency,'GHS');assert.equal(quote.charge_amount,15000);assert.equal(quote.display_currency,'GHS');
  const reference='CA-'+randomUUID();const payment=await scalar('select public.create_guest_payment($1,$2,$3,null) as result',[cap,quote.id,reference]) as Record<string,unknown>;
  assert.equal(payment.user_id,null);assert.ok(payment.applicant_id);assert.equal(payment.guest_checkout_id,checkout);assert.equal(payment.customer_email,'guest@example.invalid');assert.equal(payment.charge_amount,15000);
  assert.deepEqual(await scalar('select public.create_guest_payment($1,$2,$3,null) as result',[cap,quote.id,'CA-'+randomUUID()]),payment);
  await reject('select public.claim_guest_voucher($1,$2,$3)',[cap,pinHash,digest()]);
  await reject('select public.create_guest_payment($1,$2,$3,null)',[digest(),quote.id,'CA-'+randomUUID()],'28000');
  await reject('select public.create_guest_quote($1,$2)',[cap,ids.product]);
  pass('Service-only operations; hashed capabilities; principal/contact isolation; authoritative GHS quote; one idempotent payment per checkout; unpaid claim rejected');
  await reject('select public.fulfill_verified_payment($1,1,\'GHS\',$2,$3,null,null)',[reference,'guest@example.invalid','local-provider']);
  const voucher=await scalar("select public.fulfill_verified_payment($1,15000,'GHS',$2,$3,null,null) as result",[reference,'guest@example.invalid','local-provider']);
  assert.equal(await scalar("select public.fulfill_verified_payment($1,15000,'GHS',$2,$3,null,null) as result",[reference,'guest@example.invalid','local-provider']),voucher);
  const row=(await q('select * from public.vouchers where id=$1',[voucher]))[0];assert.equal(row.pin_hash,null);assert.equal(row.pin_encrypted,null);assert.equal(row.user_id,null);
  assert.equal(await scalar("select count(*)::int as result from public.notifications where applicant_id=$1 and title='Voucher ready'",[payment.applicant_id]),1);
  assert.equal((await q('select * from public.get_voucher_login_material($1)',[row.serial])).length,0);
  const rawSessionHash=digest();const claimed=await scalar('select public.claim_guest_voucher($1,$2,$3) as result',[cap,pinHash,rawSessionHash]) as Record<string,unknown>;
  assert.equal(claimed.serial,row.serial);assert.equal(Object.keys(claimed).some(k=>/pin|hash|token/.test(k)),false);
  await reject('select public.claim_guest_voucher($1,$2,$3)',[cap,pinHash,digest()]);
  assert.equal((await q('select * from public.get_voucher_login_material($1)',[row.serial]))[0].pin_hash,pinHash);
  const access=(await q('select * from public.voucher_access where voucher_id=$1',[voucher]))[0];assert.equal(access.credential_version,1);assert.equal(access.legacy_user_id,null);
  const session=(await q('select * from public.applicant_sessions where token_hash=$1',[rawSessionHash]))[0];assert.equal(new Date(String(session.absolute_expires_at)).getTime()-new Date(String(session.created_at)).getTime(),30*86400000);
  pass('Verified fulfillment idempotent, no voucher PIN hash/ciphertext persisted; one initial claim establishes current hash/session; replay never returns credentials');
  const app=await scalar('select public.redeem_portal_voucher($1,$2) as result',[rawSessionHash,ids.job]);
  assert.equal(await scalar('select public.redeem_portal_voucher($1,$2) as result',[rawSessionHash,ids.job]),app);
  const draft={personal:{first_name:'Guest',surname:'Fixture',date_of_birth:'1995-01-01',nationality:'Ghanaian',country_of_residence:'GH',email:'guest@example.invalid',phone:'+233200000000',address:'Local fixture'},identification:{},education:[],experience:[],answers:{}};
  await scalar('select public.save_portal_application($1,$2,0,$3) as result',[rawSessionHash,app,draft]);
  const doc=randomUUID(),path=await scalar('select public.portal_upload_context($1,$2,1,$3) as result',[rawSessionHash,app,doc]);assert.equal(path,payment.applicant_id+'/'+app+'/'+doc);
  await db.exec('reset role');await q("insert into storage.objects(bucket_id,name) values('application-documents',$1)",[path]);await db.exec('set role service_role');
  await scalar("select public.register_portal_document($1,$2,1,$3,'cv','guest.pdf','application/pdf',20) as result",[rawSessionHash,app,doc]);
  assert.equal((await scalar('select public.authorize_portal_document($1,$2,$3) as result',[rawSessionHash,app,doc]) as Record<string,unknown>).storage_path,path);
  await scalar('select public.remove_portal_document($1,$2,2,$3) as result',[rawSessionHash,app,doc]);
  await scalar('select public.submit_portal_application($1,$2,3,true) as result',[rawSessionHash,app]);
  await scalar("select public.review_application($1,$2,$3,4,'under_review','Internal CruiseApply screening only.') as result",[randomUUID(),ids.staff,app]);
  const portal=await scalar('select public.load_voucher_portal($1) as result',[rawSessionHash]) as {application:{status:string};notifications:unknown[]};assert.equal(portal.application.status,'under_review');assert.equal(portal.notifications.length,4);
  assert.equal(await scalar('select user_id as result from public.applications where id=$1',[app]),null);
  await reject('update public.vouchers set pin_hash=$1 where id=$2',[pinHash,voucher],'23514');
  await reject('update public.payments set user_id=$1,applicant_id=null where id=$2',[ids.owner,payment.id]);
  const otherCap=digest();await scalar('select public.begin_guest_checkout($1,$2,$3,$4) as result',[otherCap,'guest@example.invalid','Same contact','GH']);await reject('select public.create_guest_payment($1,$2,$3,null)',[otherCap,quote.id,'CA-'+randomUUID()]);
  const audit=await q('select metadata,actor_id from public.audit_logs where actor_applicant_id=$1',[payment.applicant_id]);for(const event of audit){assert.deepEqual(event.metadata,{});assert.equal(event.actor_id,null);}
  pass('Principal-only redemption/autosave/documents/submission/staff review work; scoped notifications/audits; legacy owner reassignment, guest ciphertext and email-based ownership rejected');
  await db.exec('reset role');
  assert.equal(await scalar("select public.fulfill_verified_payment('LOCAL-PAID',15000,'GHS','local-owner@example.invalid','12345','unused','unused') as result"),ids.voucher);
  pass('Existing legacy verified-payment replay remains compatible');
  await writeFile('test-results/guest-checkout-0011-local.json',JSON.stringify({passed:true,sqlSha256:createHash('sha256').update(sql).digest('hex'),checks,limitations:['Disposable local PostgreSQL only; hosted 0011 unapplied','True concurrent guest claims and provider checkout await hosted application and controlled E2E','Email-verified rotation/recovery remains the following stage; rollout disabled']},null,2));
}

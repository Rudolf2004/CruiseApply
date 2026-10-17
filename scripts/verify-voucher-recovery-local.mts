import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import type {PGlite} from '../test-results/sql-review/node_modules/@electric-sql/pglite/dist/index.js';
export async function verifyRecoveryStage(db:PGlite,ids:{owner:string;job:string;product:string}){
 const checks:string[]=[],q=async(s:string,a:unknown[]=[])=> (await db.query(s,a)).rows as Record<string,unknown>[],scalar=async(s:string,a:unknown[]=[])=> (await q(s,a))[0].result;
 const hash=()=>randomBytes(32).toString('hex'),pin=()=> 's1:'+randomBytes(16).toString('hex')+':'+hash();
 const reject=async(s:string,a:unknown[]=[],code='P0001')=>{try{await db.query(s,a);assert.fail('Expected rejection');}catch(e){assert.equal((e as {code?:string}).code,code);}};
 const pass=(s:string)=>{checks.push(s);console.log('PASS 0012: '+s);};
 const tables=(await q("select tablename from pg_tables where schemaname='public' order by tablename")).map(r=>r.tablename);
 async function snapshot(){const out=[];for(const t of tables)out.push(await q(`select to_jsonb(t) as row from public.${t} t order by to_jsonb(t)::text`));return JSON.stringify(out);}
 await db.exec('reset role');const before=await snapshot(),sql=await readFile('supabase/migrations/202610030012_voucher_pin_recovery.sql','utf8');
 try{await db.exec(sql.replace(/commit;\s*$/,'select 1/0; commit;'));assert.fail();}catch(e){if((e as {code?:string}).code!=='22012')console.log('Local SQL:',(e as Error).message);assert.equal((e as {code?:string}).code,'22012');await db.exec('rollback');}assert.equal(await snapshot(),before);
 await db.exec(sql);assert.equal(await snapshot(),before);pass('Exact SQL installs atomically without business-row changes; injected late failure fully rolls back');
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);for(const call of ['request_voucher_pin_reset(null,null)','complete_voucher_pin_reset(null,null,null)','revoke_voucher_pin_reset(null)'])await reject('select public.'+call,[],'42501');await db.exec('reset role');}
 await db.exec('set role service_role');await reject('select public.lock_voucher_recovery(null,true)',[],'42501');assert.equal(await scalar('select public.request_voucher_pin_reset($1,$2) as result',['CRV-missing',hash()]),null);
 const v=(await q("select v.* from public.vouchers v join public.payments p on p.id=v.payment_id where p.customer_email='guest@example.invalid' and v.status='used'"))[0];assert.ok(v);const a=(await q('select * from public.voucher_access where voucher_id=$1',[v.id]))[0];const oldHash=a.pin_hash,oldVersion=a.credential_version;
 const oldSession=hash();await q('select * from public.open_verified_voucher_session($1,$2,$3,$4)',[v.serial,oldHash,oldVersion,oldSession]);
 const first=hash(),second=hash(),nextPin=pin();const request=await scalar('select public.request_voucher_pin_reset($1,$2) as result',[v.serial,first]) as Record<string,unknown>;assert.equal(request.email,'guest@example.invalid');assert.equal(request.serial,v.serial);assert.equal(Object.keys(request).some(k=>/pin|hash|token/.test(k)),false);
 await scalar('select public.request_voucher_pin_reset($1,$2) as result',[v.serial,second]);await reject('select public.complete_voucher_pin_reset($1,$2,$3)',[v.serial,first,nextPin]);await reject('select public.complete_voucher_pin_reset($1,$2,$3)',['CRV-other',second,nextPin]);
 assert.equal((await q('select * from public.resolve_voucher_session($1)',[oldSession])).length,1);
 const completed=await scalar('select public.complete_voucher_pin_reset($1,$2,$3) as result',[v.serial,second,nextPin]);assert.deepEqual(completed,{serial:v.serial});await reject('select public.complete_voucher_pin_reset($1,$2,$3)',[v.serial,second,pin()]);
 assert.equal((await q('select * from public.resolve_voucher_session($1)',[oldSession])).length,0);await reject('select * from public.open_verified_voucher_session($1,$2,$3,$4)',[v.serial,oldHash,oldVersion,hash()]);
 assert.equal(await scalar('select count(*)::int as result from public.applicant_sessions where voucher_access_id=$1 and revoked_at is null',[a.id]),0);
 assert.equal(await scalar("select count(*)::int as result from public.audit_logs where action='voucher_pin_rotated' and target_id=$1",[a.id]),1);
 const current=await q('select * from public.get_voucher_login_material($1)',[v.serial]);assert.equal(current[0].pin_hash,nextPin);assert.equal(current[0].credential_version,Number(oldVersion)+1);assert.ok(await scalar('select verified_at as result from public.voucher_contacts where voucher_access_id=$1',[a.id]));
 await q('update public.vouchers set expires_at=now()-interval \'1 day\' where id=$1',[v.id]);const newToken=hash();await q('select * from public.open_verified_voucher_session($1,$2,$3,$4)',[v.serial,nextPin,Number(oldVersion)+1,newToken]);assert.equal((await q('select * from public.resolve_voucher_session($1)',[newToken])).length,1);
 pass('Service-only operations; generic unknown lookup; superseded/cross-voucher/consumed token rejection; verified contact; single rotation audit; all old sessions/proofs revoked; expired-used tracking retained');
 const stale=hash();await scalar('select public.request_voucher_pin_reset($1,$2) as result',[v.serial,stale]);await q("update public.voucher_contacts set email='changed@example.invalid',contact_version=contact_version+1,verified_at=null where voucher_access_id=$1",[a.id]);await reject('select public.complete_voucher_pin_reset($1,$2,$3)',[v.serial,stale,pin()]);
 const revoked=hash();await scalar('select public.request_voucher_pin_reset($1,$2) as result',[v.serial,revoked]);await q('select public.revoke_voucher_pin_reset($1)',[revoked]);await q('select public.revoke_voucher_pin_reset($1)',[revoked]);await reject('select public.complete_voucher_pin_reset($1,$2,$3)',[v.serial,revoked,pin()]);
 const expired=hash(),contact=(await q('select * from public.voucher_contacts where voucher_access_id=$1',[a.id]))[0];await q("insert into public.voucher_contact_challenges(voucher_access_id,contact_id,contact_version,purpose,token_hash,created_at,expires_at) values($1,$2,$3,'reset_pin',$4,now()-interval '1 hour',now()-interval '1 minute')",[a.id,contact.id,contact.contact_version,expired]);await reject('select public.complete_voucher_pin_reset($1,$2,$3)',[v.serial,expired,pin()]);
 await q('update public.voucher_access set suspended_at=now() where id=$1',[a.id]);assert.equal(await scalar('select public.request_voucher_pin_reset($1,$2) as result',[v.serial,hash()]),null);await q('update public.voucher_access set suspended_at=null where id=$1',[a.id]);
 pass('Changed contact versions, expired codes, revoked mail delivery and suspended access fail closed; retry revoke is harmless');
 const payment=randomUUID(),voucher=randomUUID(),serial='CRV-RECOVERY-'+randomUUID(),legacyHash=pin();
 await q("insert into public.payments(id,user_id,provider,reference,voucher_type_id,amount,currency,validity_days,customer_email,status,provider_id,paid_at) values($1,$2,'paystack',$3,$4,15000,'GHS',90,'legacy-reset@example.invalid','successful','fixture',now())",[payment,ids.owner,'CA-'+randomUUID(),ids.product]);
 await q("insert into public.vouchers(id,user_id,payment_id,voucher_type_id,serial,pin_hash,pin_encrypted,expires_at) values($1,$2,$3,$4,$5,$6,'legacy-preserved',now()+interval '1 day')",[voucher,ids.owner,payment,ids.product,serial,legacyHash]);
 const legacyCode=hash(),legacyNew=pin();const legacyRequest=await scalar('select public.request_voucher_pin_reset($1,$2) as result',[serial,legacyCode]) as Record<string,unknown>;assert.equal(legacyRequest.email,'legacy-reset@example.invalid');await scalar('select public.complete_voucher_pin_reset($1,$2,$3) as result',[serial,legacyCode,legacyNew]);
 assert.equal(await scalar('select pin_hash as result from public.vouchers where id=$1',[voucher]),legacyHash);
 await reject('select public.redeem_verified_voucher($1,$2,$3,$4)',[ids.owner,serial,legacyHash,ids.job]);const legacyToken=hash();await q('select * from public.open_verified_voucher_session($1,$2,1,$3)',[serial,legacyNew,legacyToken]);assert.ok(await scalar('select public.redeem_portal_voucher($1,$2) as result',[legacyToken,ids.job]));
 const cap=hash(),checkout=await scalar('select public.begin_guest_checkout($1,$2,$3,$4) as result',[cap,'guest@example.invalid','Pending recovery','GH']);
 const quote=await scalar('select public.create_guest_quote($1,$2) as result',[cap,ids.product]) as Record<string,unknown>;
 const ref='CA-'+randomUUID();await scalar('select public.create_guest_payment($1,$2,$3,null) as result',[cap,quote.id,ref]);
 const pendingVoucher=await scalar("select public.fulfill_verified_payment($1,15000,'GHS','guest@example.invalid','pending-fixture',null,null) as result",[ref]);
 const pendingCode=hash(),pendingPin=pin();await scalar('select public.request_voucher_pin_reset($1,$2) as result',[ref,pendingCode]);
 await reject('select public.complete_voucher_pin_reset($1,$2,$3)',[v.serial,pendingCode,pin()]);
 await scalar('select public.complete_voucher_pin_reset($1,$2,$3) as result',[ref,pendingCode,pendingPin]);
 await reject('select public.claim_guest_voucher($1,$2,$3)',[cap,pin(),hash()]);
 assert.equal(await scalar('select pin_hash as result from public.vouchers where id=$1',[pendingVoucher]),null);
 await q("update public.vouchers set status='cancelled' where id=$1",[pendingVoucher]);assert.equal(await scalar('select public.request_voucher_pin_reset($1,$2) as result',[ref,hash()]),null);
 await q("update public.payments set status='refunded' where id=$1",[v.payment_id]);const refundedCode=hash();assert.ok(await scalar('select public.request_voucher_pin_reset($1,$2) as result',[v.serial,refundedCode]));await scalar('select public.complete_voucher_pin_reset($1,$2,$3) as result',[v.serial,refundedCode,pin()]);
 assert.ok(checkout);pass('Same-email voucher codes stay isolated; payment reference still requires email proof; lost initial claim recovered without retrievable PIN; cancelled unused denial and refunded existing-application recovery');
 for(const event of await q("select actor_id,actor_applicant_id from public.audit_logs where action in ('voucher_pin_reset_requested','voucher_recovery_access_bound')")){assert.equal(event.actor_id,null);assert.equal(event.actor_applicant_id,null);}
 const audit=await q("select metadata from public.audit_logs where action in ('voucher_pin_rotated','voucher_pin_reset_requested','voucher_recovery_access_bound')");for(const r of audit)assert.deepEqual(r.metadata,{});
 pass('Legacy contact adoption uses purchase contact only; legacy stored credential rows unchanged; old PIN rejected by legacy RPC and new PIN works in scoped portal; safe audit metadata');
 await db.exec('reset role');
 const catalog=(await q(await readFile('supabase/configuration/verify-0012-readonly.sql','utf8')))[0].verification_0012 as {functions:{exists:boolean;service_callable:boolean;service_execute:boolean;anon_execute:boolean;authenticated_execute:boolean;public_execute:boolean}[]};
 assert.equal(catalog.functions.length,6);for(const f of catalog.functions){assert.equal(f.exists,true);assert.equal(f.service_execute,f.service_callable);assert.equal(f.anon_execute,false);assert.equal(f.authenticated_execute,false);assert.equal(f.public_execute,false);}
 await writeFile('test-results/voucher-recovery-0012-local-catalog.json',JSON.stringify(catalog,null,2));
 await writeFile('test-results/voucher-recovery-0012-local.json',JSON.stringify({passed:true,sqlSha256:createHash('sha256').update(sql).digest('hex'),checks,hosted:false,emailSent:false},null,2));
}

import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

// Synthetic disposable records only; no Paystack requests or real-record mutation.
const options={auth:{persistSession:false,autoRefreshToken:false}};
const url=process.env.NEXT_PUBLIC_SUPABASE_URL!,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const db=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY!,options),anon=createClient(url,key,options);
const prefix='FIXTURE-P10-'+randomUUID(),checks:string[]=[];
const users:{id:string;email:string;password:string}[]=[],payments:string[]=[],vouchers:string[]=[],apps:string[]=[],paths:string[]=[];
const privateTables=['applicant_principals','guest_checkouts','voucher_access','applicant_sessions','voucher_contacts','voucher_contact_challenges','voucher_credential_deliveries','applicant_notification_links'];
const tables=['profiles','jobs','voucher_types','payments','vouchers','applications','application_education','application_experience','application_answers','application_documents','notifications','application_status_history','application_review_commands','admin_notes','application_matches','audit_logs',...privateTables];
let phase='baseline',cleaned=false,baseline:Record<string,{count:number;hash:string}>|undefined;
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const token=()=>createHash('sha256').update(randomBytes(32)).digest('hex');
function ok<T extends {error:{code?:string}|null}>(r:T):T {if(r.error)throw new Error('DB:'+phase+':'+r.error.code);return r;}
function pass(s:string){checks.push(s);console.log('PASS: '+s);}
async function snapshot(){const result:Record<string,{count:number;hash:string}>={};for(const t of tables){const rows:unknown[]=[];const order=t==='applicant_notification_links'?'notification_id':t==='application_review_commands'?'request_id':t==='application_answers'?'application_id':'id';for(let start=0;;start+=500){let query=db.from(t).select('*').order(order);if(t==='application_answers')query=query.order('question_id');const data=ok(await query.range(start,start+499)).data!;rows.push(...data);if(data.length<500)break;}result[t]={count:rows.length,hash:hash(rows)};}return result;}
async function checkpoint(){await writeFile('test-results/voucher-portal-hosted-fixtures.json',JSON.stringify({prefix,userIds:users.map(u=>u.id),payments,vouchers,apps,paths,cleaned},null,2));}
async function cleanup(){
  phase='cleanup';
  const access=vouchers.length?ok(await db.from('voucher_access').select('id,applicant_id').in('voucher_id',vouchers)).data!:[];
  for(const a of access){for(const t of ['applicant_notification_links','voucher_credential_deliveries','voucher_contact_challenges','voucher_contacts','applicant_sessions'])ok(await db.from(t).delete().eq('voucher_access_id',a.id));ok(await db.from('voucher_access').delete().eq('id',a.id));ok(await db.from('audit_logs').delete().eq('actor_applicant_id',a.applicant_id));ok(await db.from('applicant_principals').delete().eq('id',a.applicant_id));}
  if(paths.length)ok(await db.storage.from('application-documents').remove(paths));
  // Discover any committed application even if its RPC response was interrupted.
  if(vouchers.length)for(const row of ok(await db.from('applications').select('id').in('voucher_id',vouchers)).data!)if(!apps.includes(row.id))apps.push(row.id);
  for(const id of apps){
    for(const t of ['admin_notes','application_documents']){const rows=ok(await db.from(t).select('id').eq('application_id',id)).data!;ok(await db.from(t).delete().eq('application_id',id));for(const row of rows)ok(await db.from('audit_logs').delete().eq('target_id',row.id));}
    for(const t of ['application_review_commands','application_status_history','application_answers','application_education','application_experience'])ok(await db.from(t).delete().eq('application_id',id));
    ok(await db.from('applications').delete().eq('id',id));
  }
  for(const u of users)ok(await db.from('notifications').delete().eq('user_id',u.id));
  if(vouchers.length)ok(await db.from('vouchers').delete().in('id',vouchers));
  if(payments.length)ok(await db.from('payments').delete().in('id',payments));
  for(const id of [...apps,...vouchers,...payments])ok(await db.from('audit_logs').delete().eq('target_id',id));
  for(const u of users){ok(await db.from('audit_logs').delete().eq('actor_id',u.id));ok(await db.auth.admin.deleteUser(u.id));ok(await db.from('audit_logs').delete().eq('target_id',u.id));}
  cleaned=true;await checkpoint();
}
const rpc=async(name:string,args:Record<string,unknown>)=>ok(await db.rpc(name,args)).data;
const load=(t:string)=>rpc('load_voucher_portal',{p_token_hash:t,p_notifications_page:1});
const draft={personal:{first_name:'Disposable',surname:'Portal Test',date_of_birth:'1995-01-01',nationality:'Ghanaian',country_of_residence:'Ghana',email:'fixture@example.com',phone:'+233200000000',address:'Temporary automated fixture'},identification:{},education:[{institution:'Fixture School',qualification:'Diploma',field:'Hospitality',country:'GH',start_date:'2015-01-01',completion_date:'2017-01-01'}],experience:[],answers:{}};
await mkdir('test-results',{recursive:true});
try{
  baseline=await snapshot();phase='fixtures';await checkpoint();
  for(const role of ['applicant','applicant','admin']){const email='p10-'+randomUUID()+'@example.com',password=randomBytes(32).toString('base64url');const r=ok(await db.auth.admin.createUser({email,password,email_confirm:true}));users.push({id:r.data.user!.id,email,password});await checkpoint();if(role==='admin')ok(await db.from('profiles').update({role}).eq('id',r.data.user!.id));}
  const product=ok(await db.from('voucher_types').select('id').eq('code','application-access').single()).data!;
  const job=ok(await db.from('jobs').select('id').eq('slug','hospitality-guest-services-candidate-screening').single()).data!;
  async function fixture(owner:string){const payment=randomUUID(),voucher=randomUUID(),serial=prefix+'-'+vouchers.length,t=token();payments.push(payment);vouchers.push(voucher);await checkpoint();const salt=randomBytes(16).toString('hex'),pin=randomBytes(4).readUInt32BE()%100000000,pinHash='s1:'+salt+':'+scryptSync(String(pin).padStart(8,'0'),salt,32).toString('hex');
    ok(await db.from('payments').insert({id:payment,user_id:owner,provider:'integration_fixture',reference:serial,voucher_type_id:product.id,amount:15000,currency:'GHS',validity_days:90,customer_email:'shared-fixture@example.com',status:'successful',provider_id:serial,paid_at:new Date().toISOString()}));
    ok(await db.from('vouchers').insert({id:voucher,user_id:owner,payment_id:payment,voucher_type_id:product.id,serial,pin_hash:pinHash,pin_encrypted:'NOT-A-CREDENTIAL-INTEGRATION-FIXTURE',expires_at:new Date(Date.now()+86400000).toISOString()}));
    const s=(await rpc('open_verified_voucher_session',{p_serial:serial,p_verified_pin_hash:pinHash,p_expected_credential_version:0,p_token_hash:t}))[0];return{payment,voucher,t,access:s.voucher_access_id,principal:s.applicant_id,owner};}
  const a=await fixture(users[0].id),b=await fixture(users[0].id),c=await fixture(users[1].id);
  phase='permissions';const applicant=createClient(url,key,options),staff=createClient(url,key,options);
  ok(await applicant.auth.signInWithPassword(users[0]));ok(await staff.auth.signInWithPassword(users[2]));
  const calls:[string,Record<string,unknown>][]=[['load_voucher_portal',{p_token_hash:a.t,p_notifications_page:1}],['redeem_portal_voucher',{p_token_hash:a.t,p_job_id:job.id}],['save_portal_application',{p_token_hash:a.t,p_application_id:randomUUID(),p_revision:0,p_data:draft}],['submit_portal_application',{p_token_hash:a.t,p_application_id:randomUUID(),p_revision:0,p_declaration:true}],['portal_upload_context',{p_token_hash:a.t,p_application_id:randomUUID(),p_revision:0,p_document_id:randomUUID()}],['register_portal_document',{p_token_hash:a.t,p_application_id:randomUUID(),p_revision:0,p_document_id:randomUUID(),p_kind:'cv',p_name:'test.pdf',p_mime:'application/pdf',p_size:20}],['remove_portal_document',{p_token_hash:a.t,p_application_id:randomUUID(),p_revision:0,p_document_id:randomUUID()}],['authorize_portal_document',{p_token_hash:a.t,p_application_id:randomUUID(),p_document_id:randomUUID()}],['read_portal_notification',{p_token_hash:a.t,p_notification_id:randomUUID()}]];
  for(const client of [anon,applicant,staff]){for(const [name,args] of calls)assert.equal((await client.rpc(name,args)).error?.code,'42501');for(const t of privateTables)assert.equal((await client.from(t).select('*').limit(1)).error?.code,'42501');}
  assert.equal((await db.rpc('lock_voucher_portal_scope',{p_token_hash:a.t,p_application_write:false})).error?.code,'42501');
  pass('All nine portal operations service-only; anonymous/applicant/staff JWTs denied; eight private tables denied; internal helper denied to service_role');
  phase='redemption concurrency';const redeemed=await Promise.all(Array.from({length:6},()=>db.rpc('redeem_portal_voucher',{p_token_hash:a.t,p_job_id:job.id})));const appA=String(ok(redeemed[0]).data);for(const r of redeemed)assert.equal(ok(r).data,appA);apps.push(appA);await checkpoint();
  const appB=String(await rpc('redeem_portal_voucher',{p_token_hash:b.t,p_job_id:job.id})),appC=String(await rpc('redeem_portal_voucher',{p_token_hash:c.t,p_job_id:job.id}));apps.push(appB,appC);await checkpoint();
  assert.equal((await load(a.t)).application.id,appA);assert.equal((await load(b.t)).application.id,appB);assert.equal((await load(c.t)).application.id,appC);assert.notEqual(a.principal,b.principal);
  assert.equal((await load(a.t)).payment.id,a.payment);assert.equal((await load(a.t)).payment.charge_amount,15000);
  for(const app of [appB,appC])for(const [name,args] of calls.filter(([,args])=>'p_application_id' in args))assert.equal((await db.rpc(name,{...args,p_application_id:app})).error?.code,'P0001');
  assert.equal(ok(await applicant.from('applications').select('id').eq('id',appC)).data!.length,0);
  const saves=await Promise.all(Array.from({length:6},()=>db.rpc('save_portal_application',{p_token_hash:a.t,p_application_id:appA,p_revision:0,p_data:draft})));assert.equal(saves.filter(r=>!r.error).length,1);assert.ok(saves.filter(r=>r.error).every(r=>r.error!.message.includes('Revision conflict')));
  pass('Six concurrent redemptions produce one application; same owner/contact stays isolated; foreign APIs/RLS denied; six stale-revision saves admit one');
  phase='private documents';const doc=randomUUID();const path=String(await rpc('portal_upload_context',{p_token_hash:a.t,p_application_id:appA,p_revision:1,p_document_id:doc}));paths.push(path);await checkpoint();assert.equal(path,users[0].id+'/'+appA+'/'+doc);
  const bytes=Buffer.from('%PDF-1.4\n% disposable integration fixture\n%%EOF');ok(await db.storage.from('application-documents').upload(path,bytes,{contentType:'application/pdf',upsert:false}));
  const register={p_token_hash:a.t,p_application_id:appA,p_revision:1,p_document_id:doc,p_kind:'supporting',p_name:'fixture.pdf',p_mime:'application/pdf',p_size:bytes.length};
  await rpc('register_portal_document',register);
  assert.equal((await db.rpc('authorize_portal_document',{p_token_hash:b.t,p_application_id:appA,p_document_id:doc})).error?.code,'P0001');
  assert.ok((await anon.storage.from('application-documents').download(path)).error);const other=createClient(url,key,options);ok(await other.auth.signInWithPassword(users[1]));assert.ok((await other.storage.from('application-documents').download(path)).error);
  const authorized=await rpc('authorize_portal_document',{p_token_hash:a.t,p_application_id:appA,p_document_id:doc});assert.equal(authorized.storage_path,path);assert.deepEqual(Buffer.from(await ok(await db.storage.from('application-documents').download(path)).data!.arrayBuffer()),bytes);
  const doc2=randomUUID(),path2=String(await rpc('portal_upload_context',{p_token_hash:a.t,p_application_id:appA,p_revision:2,p_document_id:doc2}));paths.push(path2);await checkpoint();ok(await db.storage.from('application-documents').upload(path2,bytes,{contentType:'application/pdf',upsert:false}));
  phase='upload submit race';const race=await Promise.all([db.rpc('register_portal_document',{...register,p_revision:2,p_document_id:doc2}),db.rpc('submit_portal_application',{p_token_hash:a.t,p_application_id:appA,p_revision:2,p_declaration:true})]);assert.equal(race.filter(r=>!r.error).length,1);assert.equal(race.filter(r=>r.error)[0].error!.code,'P0001');
  let current=(await load(a.t)).application;if(!current.submitted_at)await rpc('submit_portal_application',{p_token_hash:a.t,p_application_id:appA,p_revision:current.revision,p_declaration:true});current=(await load(a.t)).application;
  const retries=await Promise.all(Array.from({length:6},()=>db.rpc('submit_portal_application',{p_token_hash:a.t,p_application_id:appA,p_revision:0,p_declaration:true})));for(const r of retries)ok(r);
  assert.equal(ok(await db.from('application_status_history').select('id').eq('application_id',appA).eq('status','submitted')).data!.length,1);
  assert.equal(ok(await db.from('audit_logs').select('id').eq('target_id',appA).eq('action','voucher_application_submitted')).data!.length,1);
  pass('Actual private storage upload/download and foreign/anonymous denial; upload/submission race serializes; six submission retries create one history/principal event');
  phase='staff notification race';const review=await Promise.all([db.rpc('review_application',{p_request_id:randomUUID(),p_actor_id:users[2].id,p_application_id:appA,p_revision:current.revision,p_status:'under_review',p_message:'CruiseApply internal screening fixture only.'}),...Array.from({length:8},()=>db.rpc('load_voucher_portal',{p_token_hash:a.t,p_notifications_page:1}))]);for(const r of review)ok(r);
  current=(await load(a.t)).application;await rpc('add_application_note',{p_request_id:randomUUID(),p_actor_id:users[2].id,p_application_id:appA,p_revision:current.revision,p_body:'PRIVATE-PORTAL-FIXTURE-NOTE'});
  const portal=await load(a.t);assert.equal(portal.notifications.length,2);assert.equal((await load(b.t)).notifications.length,0);assert.ok(!/pin_hash|pin_encrypted|token_hash|storage_path|PRIVATE-PORTAL-FIXTURE-NOTE/.test(JSON.stringify(portal)));
  assert.equal(ok(await applicant.from('admin_notes').select('id').eq('application_id',appA)).data!.length,0);assert.equal(ok(await staff.from('admin_notes').select('id').eq('application_id',appA)).data!.length,1);
  const notice=portal.notifications[0].id;assert.equal((await db.rpc('read_portal_notification',{p_token_hash:b.t,p_notification_id:notice})).error?.code,'P0001');const reads=await Promise.all(Array.from({length:6},()=>db.rpc('read_portal_notification',{p_token_hash:a.t,p_notification_id:notice})));assert.equal(new Set(reads.map(r=>ok(r).data.read_at)).size,1);
  pass('Concurrent staff review/portal loads complete without deadlock; exact notifications isolated, concurrent reads retain one timestamp; staff notes/credentials never in DTO');
  phase='revocation races';const revoke=await Promise.all([db.rpc('logout_voucher_session',{p_token_hash:b.t}),...Array.from({length:6},()=>db.rpc('save_portal_application',{p_token_hash:b.t,p_application_id:appB,p_revision:0,p_data:draft}))]);ok(revoke[0]);for(const r of revoke.slice(1))assert.ok(!r.error||['P0001','28000'].includes(r.error.code!));assert.equal((await db.rpc('load_voucher_portal',{p_token_hash:b.t,p_notifications_page:1})).error?.code,'28000');
  ok(await db.from('vouchers').update({expires_at:new Date(Date.now()-86400000).toISOString()}).eq('id',a.voucher));assert.equal((await load(a.t)).application.id,appA);
  ok(await db.from('payments').update({status:'refunded'}).eq('id',a.payment));assert.equal((await load(a.t)).application.id,appA);assert.equal((await db.rpc('save_portal_application',{p_token_hash:a.t,p_application_id:appA,p_revision:current.revision,p_data:draft})).error?.code,'P0001');
  const rotation=await Promise.all([db.from('voucher_access').update({credential_state:'current',credential_version:1,pin_hash:'s1:'+randomBytes(16).toString('hex')+':'+randomBytes(32).toString('hex'),credential_rotated_at:new Date().toISOString()}).eq('id',c.access),db.rpc('save_portal_application',{p_token_hash:c.t,p_application_id:appC,p_revision:0,p_data:draft})]);ok(rotation[0]);assert.ok(!rotation[1].error||rotation[1].error.code==='28000');assert.equal((await db.rpc('load_voucher_portal',{p_token_hash:c.t,p_notifications_page:1})).error?.code,'28000');
  const audits=ok(await db.from('audit_logs').select('metadata,actor_id,actor_applicant_id').in('actor_applicant_id',[a.principal,b.principal,c.principal])).data!;for(const row of audits){assert.equal(row.actor_id,null);assert.deepEqual(row.metadata,{});}
  pass('Logout/write and rotation/write races fail closed after revocation; expired-used/refunded tracking retained, refunded edits denied; principal audits contain no private payload');
}catch(error){console.error('FAIL '+phase+': '+(error instanceof Error&&error.message.startsWith('DB:')?error.message:error instanceof Error?error.name:'UnknownError'));process.exitCode=1;}
finally{try{if(baseline){await cleanup();assert.deepEqual(await snapshot(),baseline);pass('All disposable users, storage objects and DB fixtures removed; complete legacy/private/staff/payment snapshots unchanged');}}catch(error){console.error('Cleanup/preservation failed: '+(error instanceof Error?error.name:'UnknownError'));process.exitCode=1;}await writeFile('test-results/voucher-portal-0010-hosted.json',JSON.stringify({testedAt:new Date().toISOString(),passed:!process.exitCode,cleaned,checks,paystackCalls:0,rollout:false,baselineCounts:baseline?Object.fromEntries(Object.entries(baseline).map(([k,v])=>[k,v.count])):null},null,2));}

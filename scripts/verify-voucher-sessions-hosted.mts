import assert from 'node:assert/strict';
import { createHash, randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

// Isolated synthetic DB fixtures only. Never calls Paystack or real voucher RPCs.
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, opts);
const anon = createClient(url, key, opts);
const prefix = 'FIXTURE-S9-' + randomUUID();
const users: {id: string; email: string; password: string}[] = [];
const paymentIds = [randomUUID(),randomUUID()];
const voucherIds = [randomUUID(),randomUUID()];
const appId = randomUUID();
const privateTables = ['applicant_principals','guest_checkouts','voucher_access','applicant_sessions','voucher_contacts','voucher_contact_challenges','voucher_credential_deliveries','applicant_notification_links'];
const preservedTables = ['profiles','payments','vouchers','applications','notifications','application_status_history','application_review_commands','admin_notes','application_matches','audit_logs',...privateTables];
const digest = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const hashToken = (raw: string) => createHash('sha256').update(raw).digest('hex');
const newToken = () => { const raw=randomBytes(32).toString('base64url'); return {raw,hash:hashToken(raw)}; };
function credentials() {
  const pin=randomInt(100000000).toString().padStart(8,'0'), salt=randomBytes(16).toString('hex');
  return {pin,hash:'s1:'+salt+':'+scryptSync(pin,salt,32).toString('hex')};
}
const originalCredential=credentials(), rotatedCredential=credentials();
const checks: string[]=[];
let phase='baseline', cleanupComplete=false;
let baseline: Record<string,{hash: string;count: number}> | undefined;
const fixturePrincipals: string[]=[];
function ok<T extends {error: {code?:string;message?:string}|null}>(result:T):T {
  if(result.error) throw new Error('Database operation failed in '+phase+' ['+(result.error.code ?? 'unknown')+']');
  return result;
}
function pass(message:string) { checks.push(message);console.log('PASS: '+message); }
async function snapshot() {
  const result: Record<string,{hash:string;count:number}>={};
  for(const table of preservedTables) {
    const rows: unknown[]=[];
    const order=table==='applicant_notification_links'?'notification_id':table==='application_review_commands'?'request_id':'id';
    for(let start=0;;start+=500) {
      const page=ok(await db.from(table).select('*').order(order).range(start,start+499)).data!;
      rows.push(...page); if(page.length<500)break;
    }
    result[table]={hash:digest(rows),count:rows.length};
  }
  return result;
}
const serial=(i:number)=>prefix+'-'+i;
const args=(i:number,t:string,hash=originalCredential.hash,version=0)=>({p_serial:serial(i),p_verified_pin_hash:hash,p_expected_credential_version:version,p_token_hash:t});
async function open(i:number,t:string,hash=originalCredential.hash,version=0) {
  return ok(await db.rpc('open_verified_voucher_session',args(i,t,hash,version))).data[0];
}
async function resolve(t:string) {return ok(await db.rpc('resolve_voucher_session',{p_token_hash:t})).data;}
async function count(table:string,column:string,id:string) {
  return ok(await db.from(table).select('*',{count:'exact',head:true}).eq(column,id)).count!;
}
async function checkpoint() {
  await writeFile('test-results/voucher-session-hosted-fixtures.json',JSON.stringify({prefix,paymentIds,voucherIds,appId,userIds:users.map(u=>u.id),principalIds:fixturePrincipals},null,2));
}
async function cleanup() {
  phase='cleanup';
  const access=ok(await db.from('voucher_access').select('id,applicant_id').in('voucher_id',voucherIds)).data!;
  const accessIds=access.map(a=>a.id), principalIds=[...new Set([...fixturePrincipals,...access.map(a=>a.applicant_id)])];
  for(const accessId of accessIds) {
    for(const table of ['applicant_notification_links','voucher_credential_deliveries','voucher_contact_challenges','voucher_contacts','applicant_sessions'])
      ok(await db.from(table).delete().eq('voucher_access_id',accessId));
  }
  if(accessIds.length)ok(await db.from('voucher_access').delete().in('id',accessIds));
  for(const principalId of principalIds) {
    ok(await db.from('audit_logs').delete().eq('actor_applicant_id',principalId));
    ok(await db.from('applicant_principals').delete().eq('id',principalId));
  }
  const notes=ok(await db.from('admin_notes').select('id').eq('application_id',appId)).data!;
  ok(await db.from('admin_notes').delete().eq('application_id',appId));
  for(const note of notes)ok(await db.from('audit_logs').delete().eq('target_type','admin_notes').eq('target_id',note.id));
  for(const table of ['application_review_commands','application_status_history'])ok(await db.from(table).delete().eq('application_id',appId));
  for(const u of users)ok(await db.from('notifications').delete().eq('user_id',u.id));
  ok(await db.from('applications').delete().eq('id',appId));
  ok(await db.from('vouchers').delete().in('id',voucherIds));
  ok(await db.from('payments').delete().in('id',paymentIds));
  for(const id of [appId,...voucherIds,...paymentIds])ok(await db.from('audit_logs').delete().eq('target_id',id));
  for(const u of users) {
    ok(await db.from('audit_logs').delete().eq('actor_id',u.id));
    ok(await db.auth.admin.deleteUser(u.id));
    ok(await db.from('audit_logs').delete().eq('target_id',u.id));
  }
  assert.equal((await db.from('payments').select('id').in('id',paymentIds)).data?.length,0);
  for(const u of users)assert.equal((await db.auth.admin.getUserById(u.id)).data.user,null);
  cleanupComplete=true;
  await writeFile('test-results/voucher-session-hosted-fixtures.json',JSON.stringify({prefix,cleaned:true},null,2));
}

await mkdir('test-results',{recursive:true});
try {
  baseline=await snapshot();
  phase='fixtures';await checkpoint();
  for(const role of ['applicant','admin']) {
    const email='s9-'+randomUUID()+'@example.com',password=randomBytes(32).toString('base64url');
    const created=ok(await db.auth.admin.createUser({email,password,email_confirm:true}));
    users.push({id:created.data.user!.id,email,password});await checkpoint();
    if(role==='admin')ok(await db.from('profiles').update({role}).eq('id',created.data.user!.id));
  }
  const [owner,staff]=users;
  const product=ok(await db.from('voucher_types').select('id').eq('code','application-access').single()).data!;
  const job=ok(await db.from('jobs').select('id').eq('slug','hospitality-guest-services-candidate-screening').single()).data!;
  for(let i=0;i<2;i++) {
    ok(await db.from('payments').insert({id:paymentIds[i],user_id:owner.id,provider:'integration_fixture',reference:serial(i),voucher_type_id:product.id,amount:1,currency:'GHS',validity_days:90,customer_email:owner.email,status:'successful',provider_id:serial(i),paid_at:new Date().toISOString()}));
    ok(await db.from('vouchers').insert({id:voucherIds[i],serial:serial(i),user_id:owner.id,payment_id:paymentIds[i],voucher_type_id:product.id,status:i===0?'used':'unused',pin_hash:originalCredential.hash,pin_encrypted:'NOT-A-CREDENTIAL-INTEGRATION-FIXTURE',expires_at:new Date(Date.now()-86400000).toISOString()}));
  }
  ok(await db.from('applications').insert({id:appId,reference:prefix,user_id:owner.id,job_id:job.id,voucher_id:voucherIds[0]}));
  const fixtureBusinessBefore=digest([ok(await db.from('payments').select('*').in('id',paymentIds).order('id')).data,ok(await db.from('vouchers').select('*').in('id',voucherIds).order('id')).data,ok(await db.from('applications').select('*').eq('id',appId)).data]);
  phase='permission checks';
  const applicant=createClient(url,key,opts),staffClient=createClient(url,key,opts);
  ok(await applicant.auth.signInWithPassword({email:owner.email,password:owner.password}));
  ok(await staffClient.auth.signInWithPassword({email:staff.email,password:staff.password}));
  for(const client of [anon,applicant,staffClient]) {
    const denied=await Promise.all([
      client.rpc('get_voucher_login_material',{p_serial:serial(0)}),
      client.rpc('open_verified_voucher_session',args(0,newToken().hash)),
      client.rpc('resolve_voucher_session',{p_token_hash:newToken().hash}),
      client.rpc('logout_voucher_session',{p_token_hash:newToken().hash}),
    ]);
    for(const result of denied)assert.equal(result.error?.code,'42501');
    for(const table of privateTables)assert.equal((await client.from(table).select('*').limit(1)).error?.code,'42501');
  }
  pass('All four RPCs and eight private tables deny anonymous, authenticated applicant and authenticated staff direct access');
  phase='credential proof';
  const material=ok(await db.rpc('get_voucher_login_material',{p_serial:serial(0)})).data[0];
  const [,salt,stored]=material.pin_hash.split(':');
  assert.ok(timingSafeEqual(scryptSync(originalCredential.pin,salt,32),Buffer.from(stored,'hex')));
  assert.equal(material.credential_version,0);
  for(const bad of [{...args(0,newToken().hash),p_verified_pin_hash:rotatedCredential.hash},{...args(0,newToken().hash),p_expected_credential_version:1},{...args(0,'raw-token')},{...args(0,newToken().hash),p_serial:'MISSING-'+prefix}])
    assert.equal((await db.rpc('open_verified_voucher_session',bad)).error?.code,'P0001');
  assert.equal(await count('voucher_access','voucher_id',voucherIds[0]),0);
  phase='concurrent first logins';
  const tokens=Array.from({length:6},newToken);
  const openings=await Promise.all(tokens.map(t=>db.rpc('open_verified_voucher_session',args(0,t.hash))));
  const opened=openings.map(r=>ok(r).data[0]);
  assert.equal(new Set(opened.map(r=>r.voucher_access_id)).size,1);
  const accessId=opened[0].voucher_access_id, principalId=opened[0].applicant_id;
  fixturePrincipals.push(principalId);await checkpoint();
  assert.equal(await count('voucher_access','voucher_id',voucherIds[0]),1);
  assert.equal(await count('applicant_sessions','voucher_access_id',accessId),6);
  const bindingAudit=ok(await db.from('audit_logs').select('id').eq('target_id',accessId).eq('action','voucher_access_bound')).data!;assert.equal(bindingAudit.length,1);
  for(const s of opened)assert.equal(Date.parse(s.absolute_expires_at)-Date.parse(s.idle_expires_at),23*86400000);
  const sessionRows=ok(await db.from('applicant_sessions').select('*').eq('voucher_access_id',accessId)).data!;
  for(const s of sessionRows) {
    assert.equal(Date.parse(s.idle_expires_at)-Date.parse(s.created_at),7*86400000);
    assert.equal(Date.parse(s.absolute_expires_at)-Date.parse(s.created_at),30*86400000);
    assert.ok(tokens.some(t=>t.hash===s.token_hash));assert.ok(!tokens.some(t=>t.raw===s.token_hash));
  }
  const duplicate=newToken();
  const duplicates=await Promise.all(Array.from({length:6},()=>db.rpc('open_verified_voucher_session',args(0,duplicate.hash))));
  assert.equal(duplicates.filter(r=>!r.error).length,1);
  assert.ok(duplicates.filter(r=>r.error).every(r=>r.error!.code==='23505'));
  pass('Actual server scrypt proof; wrong hash/version/raw token rejected; six concurrent first logins produce one binding; duplicate token creates one session');
  phase='scope and refresh';
  const second=newToken(),secondSession=await open(1,second.hash);
  fixturePrincipals.push(secondSession.applicant_id);await checkpoint();
  assert.notEqual(secondSession.applicant_id,principalId);
  for(const t of tokens) {
    const scope=(await resolve(t.hash))[0];
    assert.equal(scope.application_id,appId);assert.equal(scope.payment_id,paymentIds[0]);assert.equal(scope.voucher_id,voucherIds[0]);
    assert.ok(!Object.keys(scope).some(k=>/pin|token|email|user_id|note/.test(k)));
    assert.equal(scope.absolute_expires_at,opened[tokens.indexOf(t)].absolute_expires_at);
  }
  const secondScope=(await resolve(second.hash))[0];assert.equal(secondScope.application_id,null);assert.equal(secondScope.payment_id,paymentIds[1]);
  const refreshBefore=ok(await db.from('applicant_sessions').select('*').eq('token_hash',tokens[0].hash).single()).data!;
  const refreshes=await Promise.all(Array.from({length:6},()=>db.rpc('resolve_voucher_session',{p_token_hash:tokens[0].hash})));
  for(const r of refreshes)assert.equal(ok(r).data.length,1);
  const refreshAfter=ok(await db.from('applicant_sessions').select('*').eq('token_hash',tokens[0].hash).single()).data!;
  assert.equal(refreshAfter.created_at,refreshBefore.created_at);assert.equal(refreshAfter.absolute_expires_at,refreshBefore.absolute_expires_at);
  assert.ok(Date.parse(refreshAfter.last_seen_at)>=Date.parse(refreshBefore.last_seen_at));
  assert.equal(Date.parse(refreshAfter.idle_expires_at),Math.min(Date.parse(refreshAfter.last_seen_at)+7*86400000,Date.parse(refreshAfter.absolute_expires_at)));
  assert.equal((await resolve(newToken().hash)).length,0);
  assert.equal(digest([ok(await db.from('payments').select('*').in('id',paymentIds).order('id')).data,ok(await db.from('vouchers').select('*').in('id',voucherIds).order('id')).data,ok(await db.from('applications').select('*').eq('id',appId)).data]),fixtureBusinessBefore);
  pass('Same legacy owner/email remains two voucher scopes; used/expired voucher tracking works; concurrent refresh preserves absolute expiry and business records');
  phase='expiry bounds';
  const now=Date.now(),iso=(offset:number)=>new Date(now+offset*86400000).toISOString();
  const idleToken=newToken(),absoluteToken=newToken(),capToken=newToken();
  ok(await db.from('applicant_sessions').insert([
    {voucher_access_id:accessId,token_hash:idleToken.hash,credential_version:0,created_at:iso(-8),last_seen_at:iso(-8),idle_expires_at:iso(-1),absolute_expires_at:iso(22)},
    {voucher_access_id:accessId,token_hash:absoluteToken.hash,credential_version:0,created_at:iso(-31),last_seen_at:iso(-2),idle_expires_at:iso(-1),absolute_expires_at:iso(-1)},
    {voucher_access_id:accessId,token_hash:capToken.hash,credential_version:0,created_at:iso(-29),last_seen_at:iso(-1),idle_expires_at:iso(1),absolute_expires_at:iso(1)},
  ]));
  assert.equal((await resolve(idleToken.hash)).length,0);assert.equal((await resolve(absoluteToken.hash)).length,0);
  const cap=(await resolve(capToken.hash))[0];assert.equal(cap.idle_expires_at,cap.absolute_expires_at);
  pass('Seven-day idle and thirty-day absolute expiration enforced; near-expiry refresh capped at original absolute limit');
  phase='logout races';
  const raceLogout=await Promise.all([...Array.from({length:6},()=>db.rpc('logout_voucher_session',{p_token_hash:tokens[0].hash})),...Array.from({length:6},()=>db.rpc('resolve_voucher_session',{p_token_hash:tokens[0].hash}))]);
  for(const r of raceLogout)ok(r);
  assert.equal((await resolve(tokens[0].hash)).length,0);assert.equal((await resolve(tokens[1].hash)).length,1);
  assert.equal(ok(await db.from('audit_logs').select('id').eq('action','applicant_session_logged_out').eq('target_id',opened[0].session_id)).data!.length,1);
  pass('Concurrent logout/refresh cannot restore a session; six logout retries produce one event and preserve other sessions');
  phase='credential rotation races';
  const racingToken=newToken();
  const rotationRace=await Promise.all([
    db.from('voucher_access').update({credential_state:'current',pin_hash:rotatedCredential.hash,credential_version:1,credential_rotated_at:new Date().toISOString()}).eq('id',accessId),
    db.rpc('open_verified_voucher_session',args(0,racingToken.hash)),
    db.rpc('resolve_voucher_session',{p_token_hash:tokens[1].hash}),
  ]);
  ok(rotationRace[0]);assert.ok(!rotationRace[1].error||rotationRace[1].error.code==='P0001');ok(rotationRace[2]);
  assert.equal((await resolve(racingToken.hash)).length,0);assert.equal((await resolve(tokens[1].hash)).length,0);
  const newMaterial=ok(await db.rpc('get_voucher_login_material',{p_serial:serial(0)})).data[0];assert.equal(newMaterial.pin_hash,rotatedCredential.hash);assert.equal(newMaterial.credential_version,1);
  assert.equal((await db.rpc('open_verified_voucher_session',args(0,newToken().hash,originalCredential.hash,1))).error?.code,'P0001');
  const fresh=newToken();await open(0,fresh.hash,rotatedCredential.hash,1);
  assert.equal((await resolve(fresh.hash)).length,1);
  pass('Credential-version/hash update racing login/refresh invalidates every old-version session; current credentials never fall back to legacy PIN hash');
  phase='lifecycle and suspension';
  for(const status of ['unused','used','expired','cancelled','refunded']) {
    ok(await db.from('vouchers').update({status}).eq('id',voucherIds[1]));
    assert.equal((await resolve(second.hash)).length,1);
    assert.equal((await open(1,newToken().hash)).voucher_id,voucherIds[1]);
  }
  ok(await db.from('payments').update({status:'refunded'}).eq('id',paymentIds[1]));await open(1,newToken().hash);
  ok(await db.from('voucher_access').update({suspended_at:new Date().toISOString()}).eq('id',accessId));
  assert.equal((await resolve(fresh.hash)).length,0);assert.equal(ok(await db.rpc('get_voucher_login_material',{p_serial:serial(0)})).data.length,0);
  assert.equal((await db.rpc('open_verified_voucher_session',args(0,newToken().hash,rotatedCredential.hash,1))).error?.code,'P0001');
  ok(await db.from('voucher_access').update({suspended_at:null}).eq('id',accessId));
  ok(await db.from('applicant_principals').update({disabled_at:new Date().toISOString()}).eq('id',principalId));
  assert.equal((await resolve(fresh.hash)).length,0);assert.equal((await db.rpc('open_verified_voucher_session',args(0,newToken().hash,rotatedCredential.hash,1))).error?.code,'P0001');
  ok(await db.from('applicant_principals').update({disabled_at:null}).eq('id',principalId));
  const revokeRace=await Promise.all([db.from('voucher_access').update({revoked_at:new Date().toISOString()}).eq('id',accessId),...Array.from({length:6},()=>db.rpc('resolve_voucher_session',{p_token_hash:fresh.hash}))]);
  for(const r of revokeRace)ok(r);assert.equal((await resolve(fresh.hash)).length,0);
  ok(await db.rpc('logout_voucher_session',{p_token_hash:fresh.hash}));
  pass('Billing/redemption state does not disable tracking; suspension, disabled principal and concurrent access revocation do; revoked-session logout remains safe');
  phase='audit and staff regression';
  const audits=ok(await db.from('audit_logs').select('*').in('actor_applicant_id',fixturePrincipals)).data!;
  for(const row of audits) {
    assert.deepEqual(row.metadata,{});assert.equal(row.actor_id,null);assert.ok(fixturePrincipals.includes(row.actor_applicant_id));
    assert.ok(['voucher_access_bound','applicant_session_opened','applicant_session_logged_out'].includes(row.action));
  }
  for(const secret of [originalCredential.pin,rotatedCredential.pin,originalCredential.hash,rotatedCredential.hash,...tokens.flatMap(t=>[t.raw,t.hash])])assert.ok(!JSON.stringify(audits).includes(secret));
  ok(await db.from('applications').update({status:'submitted',submitted_at:new Date().toISOString(),declaration_at:new Date().toISOString()}).eq('id',appId));
  ok(await db.rpc('review_application',{p_request_id:randomUUID(),p_actor_id:staff.id,p_application_id:appId,p_revision:0,p_status:'under_review',p_message:'Temporary session compatibility test review.'}));
  ok(await db.rpc('add_application_note',{p_request_id:randomUUID(),p_actor_id:staff.id,p_application_id:appId,p_revision:1,p_body:'Private temporary session compatibility note.'}));
  assert.equal(ok(await applicant.from('admin_notes').select('id').eq('application_id',appId)).data!.length,0);
  assert.equal(ok(await staffClient.from('admin_notes').select('id').eq('application_id',appId)).data!.length,1);
  pass('No credential/session secrets in audit; existing staff review/note RPCs and applicant/staff RLS remain functional on isolated fixtures');
} catch(error) {
  console.error('FAIL at '+phase+': '+(error instanceof Error && error.message.startsWith('Database operation failed in ')?error.message:error instanceof Error?error.name:'UnknownError'));
  process.exitCode=1;
} finally {
  try {
    if(baseline) {
      await cleanup();
      assert.deepEqual(await snapshot(),baseline,'Existing hosted data changed');
      pass('All fixtures removed; complete before/after snapshots of legacy, staff-review, audit and eight 0008 tables match');
    }
  } catch(error) {
    console.error('Cleanup/preservation verification failed: '+(error instanceof Error?error.name:'UnknownError'));
    process.exitCode=1;
  }
  await writeFile('test-results/voucher-session-0009-hosted.json',JSON.stringify({testedAt:new Date().toISOString(),passed:!process.exitCode,checks,cleanupComplete,baselineCounts:baseline?Object.fromEntries(Object.entries(baseline).map(([k,v])=>[k,v.count])):null,paystackCalls:0,cutover:false,limits:['Behavioral API/JWT tests; no new applicant browser routes exist','Exact function definition/catalog export requires SQL Editor; no PostgreSQL connection configured','Credential rotation simulated on temporary fixture; no reset endpoint implemented']},null,2));
}

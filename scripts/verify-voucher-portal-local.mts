import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import type { PGlite } from '../test-results/sql-review/node_modules/@electric-sql/pglite/dist/index.js';

// Disposable embedded PostgreSQL only. No env loading, HTTP or hosted client.
export async function verifyPortalStage(db: PGlite, ids: { voucher: string; owner: string; application: string; staff: string; job: string; product: string }) {
  const checks: string[] = [];
  const pass = (message: string) => { checks.push(message); console.log('PASS 0010: '+message); };
  const q = async (sql: string, args: unknown[] = []) => (await db.query(sql,args)).rows as Record<string,unknown>[];
  const scalar = async (sql: string, args: unknown[] = []) => (await q(sql,args))[0].result;
  const token = () => createHash('sha256').update(randomBytes(32)).digest('hex');
  async function reject(sql: string, args: unknown[] = [], code = 'P0001') {
    try { await db.query(sql,args); assert.fail('Expected SQL rejection'); }
    catch (error) { assert.equal((error as {code?:string}).code,code); }
  }
  const tables = (await q("select tablename from pg_tables where schemaname='public' order by tablename")).map(r=>String(r.tablename));
  async function snapshot() {
    const rows = [];
    for (const table of tables) rows.push(await q(`select to_jsonb(t) as row from public.${table} t order by to_jsonb(t)::text`));
    return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  }
  await db.exec(await readFile('supabase/migrations/202610020009_voucher_session_operations.sql','utf8'));
  await db.exec('alter default privileges in schema public grant execute on functions to anon,authenticated,service_role');
  const filename = '202610030010_voucher_scoped_portal.sql';
  const sql = await readFile('supabase/migrations/'+filename,'utf8');
  const before = await snapshot();
  const policySql = "select * from pg_policies where schemaname='public' order by tablename,policyname";
  const grantSql = "select relname,relacl::text,relrowsecurity from pg_class where oid=any($1::regclass[]) order by relname";
  const policies = await q(policySql), grants = await q(grantSql,[tables.map(t=>'public.'+t)]);
  const functions = await q("select p.oid,p.proname,pg_get_functiondef(p.oid) as definition,p.proacl::text,p.proowner from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by p.oid");
  try { await db.exec(sql.replace(/commit;\s*$/i,'select 1/0;\ncommit;')); assert.fail('Expected rollback'); }
  catch(error) { assert.equal((error as {code?:string}).code,'22012'); await db.exec('rollback'); }
  assert.equal(await scalar("select to_regprocedure('public.load_voucher_portal(text,integer)') as result"),null);
  assert.equal(await snapshot(),before);
  for (const fn of functions) assert.deepEqual((await q('select p.oid,p.proname,pg_get_functiondef(p.oid) as definition,p.proacl::text,p.proowner from pg_proc p where p.oid=$1',[fn.oid]))[0],fn);
  await db.exec(sql);
  assert.equal(await snapshot(),before);
  assert.deepEqual(await q(policySql),policies);
  assert.deepEqual(await q(grantSql,[tables.map(t=>'public.'+t)]),grants);
  const canonical = (s: string) => s.replace(/--[^\n]*/g,'').replace(/for no key update/g,'for update').replace(/\s+/g,' ').trim();
  for (const fn of functions) {
    const actual = (await q('select p.oid,p.proname,pg_get_functiondef(p.oid) as definition,p.proacl::text,p.proowner from pg_proc p where p.oid=$1',[fn.oid]))[0];
    if (fn.proname === 'resolve_voucher_session') {
      assert.equal(canonical(String(actual.definition)),canonical(String(fn.definition)));
      assert.deepEqual({...actual,definition:fn.definition},fn);
    } else assert.deepEqual(actual,fn);
  }
  assert.equal(await scalar("select count(*)::int as result from information_schema.columns where table_schema='public' and column_name='user_id' and table_name=any($1) and is_nullable='NO'",[['payment_quotes','payments','vouchers','applicants','applications','application_documents','notifications']]),7);
  pass('Exact SQL executes; injected late failure rolls back; all business data, RLS, table grants, owner constraints and old functions unchanged except documented resolver lock mode');

  const calls = [
    'load_voucher_portal(null,1)','redeem_portal_voucher(null,null)',
    'save_portal_application(null,null,0,null)','submit_portal_application(null,null,0,true)',
    'portal_upload_context(null,null,0,null)','register_portal_document(null,null,0,null,null,null,null,1)',
    'remove_portal_document(null,null,0,null)','authorize_portal_document(null,null,null)',
    'read_portal_notification(null,null)',
  ];
  for (const role of ['anon','authenticated']) {
    await db.exec('set role '+role);
    for (const call of calls) await reject('select public.'+call,[],'42501');
    await db.exec('reset role');
  }
  const signatures = [
    'load_voucher_portal(text,integer)','redeem_portal_voucher(text,uuid)',
    'save_portal_application(text,uuid,integer,jsonb)','submit_portal_application(text,uuid,integer,boolean)',
    'portal_upload_context(text,uuid,integer,uuid)','register_portal_document(text,uuid,integer,uuid,text,text,text,integer)',
    'remove_portal_document(text,uuid,integer,uuid)','authorize_portal_document(text,uuid,uuid)','read_portal_notification(text,uuid)',
  ];
  for (const signature of signatures) {
    const catalog = (await q("select p.prosecdef,p.proconfig,has_function_privilege('service_role',p.oid,'execute') as service,has_function_privilege('anon',p.oid,'execute') as anon,has_function_privilege('authenticated',p.oid,'execute') as authenticated,exists(select 1 from aclexplode(p.proacl) a where a.grantee=0) as public from pg_proc p where p.oid=$1::regprocedure",['public.'+signature]))[0];
    assert.equal(catalog.prosecdef,true); assert.equal(catalog.service,true);
    assert.equal(catalog.anon,false); assert.equal(catalog.authenticated,false); assert.equal(catalog.public,false);
    assert.deepEqual(catalog.proconfig,['search_path=""']);
  }
  await db.exec('set role service_role');
  for (const call of calls) await reject('select public.'+call,[],'28000');
  await reject('select public.lock_voucher_portal_scope(null)',[],'42501');
  await reject('select public.link_voucher_application_notification()',[],'42501');
  await db.exec('reset role');
  pass('Nine RPCs service-only with empty search_path; anonymous/authenticated denied; internal helper/trigger not directly executable by service_role');
  const catalogResults=await db.exec(await readFile('supabase/configuration/verify-0010-readonly.sql','utf8'));
  const catalog=catalogResults.flatMap(r=>r.rows).find(r=>'verification_0010' in r)?.verification_0010 as {functions:{exists:boolean;service_callable:boolean;service_execute:boolean;anon_execute:boolean;authenticated_execute:boolean;public_execute:boolean}[];owner_columns:unknown[];private_tables:unknown[];notification_trigger:unknown};
  assert.equal(catalog.functions.length,12); assert.equal(catalog.owner_columns.length,14); assert.equal(catalog.private_tables.length,8); assert.ok(catalog.notification_trigger);
  for(const fn of catalog.functions) {
    assert.ok(fn.exists); assert.equal(fn.service_execute,fn.service_callable);
    assert.equal(fn.anon_execute,false); assert.equal(fn.authenticated_execute,false); assert.equal(fn.public_execute,false);
  }
  await writeFile('test-results/voucher-portal-0010-local-catalog.json',JSON.stringify(catalog,null,2));

  const baseRows = await q('select to_jsonb(a) as row from public.applications a where id=$1',[ids.application]);
  const legacyHash = 's1:'+'a'.repeat(32)+':'+'b'.repeat(64);
  const otherOwner = randomUUID();
  await q('insert into auth.users(id,email) values($1,$2)',[otherOwner,'portal-other@example.invalid']);
  async function fixture(owner: string) {
    const payment = randomUUID(),voucher = randomUUID(),serial = 'PORTAL-'+randomUUID(),hashedToken=token();
    await q(`insert into public.payments(id,user_id,reference,voucher_type_id,amount,currency,validity_days,customer_email,status,provider_id,paid_at)
      values($1,$2,$3,$4,15000,'GHS',90,'same-contact@example.invalid','successful',$3,now())`,[payment,owner,serial,ids.product]);
    await q(`insert into public.vouchers(id,user_id,payment_id,voucher_type_id,serial,pin_hash,pin_encrypted,expires_at)
      values($1,$2,$3,$4,$5,$6,'LOCAL-CIPHERTEXT',now()+interval '90 days')`,[voucher,owner,payment,ids.product,serial,legacyHash]);
    const opened = (await q('select * from public.open_verified_voucher_session($1,$2,0,$3)',[serial,legacyHash,hashedToken]))[0];
    return {owner,payment,voucher,serial,token:hashedToken,access:String(opened.voucher_access_id),principal:String(opened.applicant_id)};
  }
  const a = await fixture(ids.owner),b = await fixture(ids.owner),c = await fixture(otherOwner);
  assert.notEqual(a.principal,b.principal);
  const load = async (t: string) => await scalar('select public.load_voucher_portal($1) as result',[t]) as {voucher:{id:string};payment:{id:string;charge_amount:number;charge_currency:string};application:null|{id:string;status:string;revision:number;history:unknown[];documents:unknown[]};notifications:{id:string}[];unread_count:number};
  const redeem = async (t: string) => String(await scalar('select public.redeem_portal_voucher($1,$2) as result',[t,ids.job]));
  await db.exec('set role service_role');
  const initial = await load(a.token); assert.equal(initial.application,null); assert.equal(initial.payment.charge_amount,15000); assert.equal(initial.payment.charge_currency,'GHS');
  const appA = await redeem(a.token),appB = await redeem(b.token),appC = await redeem(c.token);
  assert.equal(await redeem(a.token),appA);
  assert.equal(await scalar("select count(*)::int as result from public.audit_logs where target_id=$1 and action='voucher_application_started'",[appA]),1);
  await reject('select public.redeem_portal_voucher($1,$2)',[a.token,randomUUID()]);
  assert.equal((await load(a.token)).application?.id,appA); assert.equal((await load(b.token)).application?.id,appB);
  assert.equal((await load(c.token)).application?.id,appC);
  await reject('select public.load_voucher_portal($1,0)',[a.token]);
  pass('Same owner/email vouchers bind distinct principals; single-voucher dashboard/payment scope; redemption replay returns one application/audit event');

  const draft = {personal:{first_name:'Local',surname:'Applicant',date_of_birth:'1995-01-01',nationality:'Ghanaian',country_of_residence:'Ghana',email:'local@example.invalid',phone:'+233200000000',address:'Local fixture only'},identification:{},education:[{institution:'Local School',qualification:'Diploma',field:'Hospitality',country:'GH',start_date:'2015-01-01',completion_date:'2017-01-01'}],experience:[{employer:'Local fixture',position:'Assistant',location:'GH',start_date:'2018-01-01',end_date:'2019-01-01',responsibilities:'Local fixture only'}],answers:{}};
  for (const app of [appB,appC,ids.application]) {
    await reject('select public.save_portal_application($1,$2,0,$3)',[a.token,app,draft]);
    await reject('select public.submit_portal_application($1,$2,0,true)',[a.token,app]);
    await reject('select public.portal_upload_context($1,$2,0,$3)',[a.token,app,randomUUID()]);
    await reject('select public.authorize_portal_document($1,$2,$3)',[a.token,app,randomUUID()]);
    await reject('select public.remove_portal_document($1,$2,0,$3)',[a.token,app,randomUUID()]);
    await reject('select public.register_portal_document($1,$2,0,$3,$4,$5,$6,10)',[a.token,app,randomUUID(),'cv','a.pdf','application/pdf']);
  }
  assert.deepEqual(await scalar('select public.save_portal_application($1,$2,0,$3)->\'revision\' as result',[a.token,appA,draft]),1);
  await reject('select public.save_portal_application($1,$2,0,$3)',[a.token,appA,draft]);
  const doc = randomUUID();
  const path = String(await scalar('select public.portal_upload_context($1,$2,1,$3) as result',[a.token,appA,doc]));
  assert.equal(path,a.owner+'/'+appA+'/'+doc);
  await reject('select public.register_portal_document($1,$2,1,$3,$4,$5,$6,10)',[a.token,appA,doc,'cv','a.pdf','application/pdf']);
  await db.exec('reset role');
  await q("insert into storage.objects(bucket_id,name) values('application-documents',$1)",[path]);
  await db.exec('set role service_role');
  await reject('select public.register_portal_document($1,$2,1,$3,$4,$5,$6,10)',[a.token,appA,doc,'cv','a.pdf','text/html']);
  const registered = await scalar('select public.register_portal_document($1,$2,1,$3,$4,$5,$6,10) as result',[a.token,appA,doc,'cv','a.pdf','application/pdf']) as {revision:number};
  assert.equal(registered.revision,2);
  assert.deepEqual(await scalar('select public.authorize_portal_document($1,$2,$3) as result',[a.token,appA,doc]),{storage_path:path,name:'a.pdf',mime_type:'application/pdf'});
  await reject('select public.authorize_portal_document($1,$2,$3)',[b.token,appA,doc]);
  await reject('select public.authorize_portal_document($1,$2,$3)',[b.token,appB,doc]);
  await reject('select public.remove_portal_document($1,$2,1,$3)',[a.token,appA,doc]);
  const removed = await scalar('select public.remove_portal_document($1,$2,2,$3) as result',[a.token,appA,doc]) as {revision:number;storagePath:string};
  assert.equal(removed.revision,3); assert.equal(removed.storagePath,path);
  await reject('select public.authorize_portal_document($1,$2,$3)',[a.token,appA,doc]);
  await scalar('select public.register_portal_document($1,$2,3,$3,$4,$5,$6,10) as result',[a.token,appA,doc,'cv','a.pdf','application/pdf']);
  pass('Cross-voucher and cross-owner application/document operations rejected; revision autosave, education/experience, private path derivation, missing-object/type checks and metadata deletion verified');

  await reject('select public.submit_portal_application($1,$2,3,true)',[a.token,appA]);
  await reject('select public.submit_portal_application($1,$2,4,false)',[a.token,appA]);
  const submitted = await scalar('select public.submit_portal_application($1,$2,4,true) as result',[a.token,appA]);
  assert.deepEqual(await scalar('select public.submit_portal_application($1,$2,4,true) as result',[a.token,appA]),submitted);
  assert.equal(await scalar("select count(*)::int as result from public.audit_logs where target_id=$1 and action='voucher_application_submitted'",[appA]),1);
  assert.equal(await scalar("select count(*)::int as result from public.application_status_history where application_id=$1 and status='submitted'",[appA]),1);
  await reject('select public.save_portal_application($1,$2,5,$3)',[a.token,appA,draft]);
  await reject('select public.portal_upload_context($1,$2,5,$3)',[a.token,appA,randomUUID()]);
  const own = await load(a.token); assert.equal(own.notifications.length,1);
  const notification = own.notifications[0].id;
  await reject('select public.read_portal_notification($1,$2)',[b.token,notification]);
  const read = await scalar('select public.read_portal_notification($1,$2) as result',[a.token,notification]);
  assert.deepEqual(await scalar('select public.read_portal_notification($1,$2) as result',[a.token,notification]),read);
  assert.equal((await load(a.token)).unread_count,0);
  await q("select public.review_application($1,$2,$3,5,'under_review','CruiseApply internal screening has started.')",[randomUUID(),ids.staff,appA]);
  await q("select public.add_application_note($1,$2,$3,6,'PRIVATE-NOTE-NOT-FOR-APPLICANT')",[randomUUID(),ids.staff,appA]);
  const reviewed = await load(a.token); assert.equal(reviewed.application?.status,'under_review'); assert.equal(reviewed.notifications.length,2);
  assert.equal((await load(b.token)).notifications.length,0);
  const forbidden = /pin_hash|pin_encrypted|token_hash|storage_path|legacy_user_id|PRIVATE-NOTE-NOT-FOR-APPLICANT/;
  assert.equal(forbidden.test(JSON.stringify(reviewed)),false);
  await db.exec('reset role');
  await q("insert into public.notifications(user_id,title,body,href) values($1,'Wrong owner','Wrong owner',$2),($3,'Generic','Unscoped','/dashboard/applications')",[otherOwner,'/dashboard/applications/'+appA,ids.owner]);
  assert.equal((await load(a.token)).notifications.length,2);
  const events = await q("select actor_applicant_id,actor_id,metadata from public.audit_logs where action=any($1)",[['voucher_application_started','voucher_application_saved','voucher_application_submitted','voucher_document_added','voucher_document_removed']]);
  assert.ok(events.length>0); for (const event of events) { assert.ok(event.actor_applicant_id); assert.equal(event.actor_id,null); assert.deepEqual(event.metadata,{}); }
  pass('Submission replay produces one principal event/history; submitted edits denied; staff review/notes compatible; only linked notifications visible; read retries stable; credentials, staff notes and storage paths absent from portal DTO');

  await q("update public.vouchers set expires_at=now()-interval '1 day' where id=$1",[a.voucher]);
  assert.equal((await load(a.token)).application?.id,appA);
  for (const state of ['cancelled','refunded']) {
    await q('update public.vouchers set status=$1::public.voucher_status where id=$2',[state,a.voucher]);
    assert.equal((await load(a.token)).application?.id,appA);
    await reject('select public.save_portal_application($1,$2,6,$3)',[a.token,appA,draft]);
  }
  await q("update public.payments set status='refunded' where id=$1",[a.payment]);
  assert.equal((await load(a.token)).application?.id,appA);
  for (const state of ['expired','cancelled','refunded']) {
    const f = await fixture(ids.owner);
    await q('update public.vouchers set status=$1::public.voucher_status where id=$2',[state,f.voucher]);
    assert.equal((await load(f.token)).application,null);
    await reject('select public.redeem_portal_voucher($1,$2)',[f.token,ids.job]);
  }
  const unpaid = await fixture(ids.owner);
  await q("update public.payments set status='refunded' where id=$1",[unpaid.payment]);
  await reject('select public.redeem_portal_voucher($1,$2)',[unpaid.token,ids.job]);
  const expired = await fixture(ids.owner);
  await q("update public.vouchers set expires_at=now()-interval '1 day' where id=$1",[expired.voucher]);
  await reject('select public.redeem_portal_voucher($1,$2)',[expired.token,ids.job]);
  pass('Used voucher ordinary expiry preserves tracking; cancelled/refunded existing applications remain readable; invalid/expired unused entitlements cannot redeem');

  for (const mutation of [
    'update public.voucher_access set suspended_at=now() where id=$1',
    'update public.applicant_principals set disabled_at=now() where id=$1',
    'update public.voucher_access set credential_version=1 where id=$1',
    'update public.voucher_access set revoked_at=now() where id=$1',
  ]) {
    const f = await fixture(ids.owner);
    if (mutation.includes('credential_version')) {
      await q("update public.voucher_access set credential_state='current',credential_version=1,pin_hash=$2,credential_rotated_at=now() where id=$1",[f.access,'s1:'+'c'.repeat(32)+':'+'d'.repeat(64)]);
    } else await q(mutation,[mutation.includes('applicant_principals')?f.principal:f.access]);
    await reject('select public.load_voucher_portal($1)',[f.token],'28000');
    await reject('select public.redeem_portal_voucher($1,$2)',[f.token,ids.job],'28000');
  }
  const timeout = await fixture(ids.owner),oldToken=token();
  await q(`insert into public.applicant_sessions(voucher_access_id,token_hash,credential_version,created_at,last_seen_at,idle_expires_at,absolute_expires_at)
    values($1,$2,0,now()-interval '8 days',now()-interval '8 days',now()-interval '1 day',now()+interval '22 days')`,[timeout.access,oldToken]);
  await reject('select public.load_voucher_portal($1)',[oldToken],'28000');
  const absoluteToken=token(),cappedToken=token();
  await q(`insert into public.applicant_sessions(voucher_access_id,token_hash,credential_version,created_at,last_seen_at,idle_expires_at,absolute_expires_at)
    values($1,$2,0,now()-interval '31 days',now()-interval '2 days',now()-interval '1 day',now()-interval '1 day'),
      ($1,$3,0,now()-interval '29 days',now()-interval '1 day',now()+interval '1 day',now()+interval '1 day')`,[timeout.access,absoluteToken,cappedToken]);
  await reject('select public.load_voucher_portal($1)',[absoluteToken],'28000');
  await load(cappedToken);
  assert.equal(await scalar('select idle_expires_at=absolute_expires_at as result from public.applicant_sessions where token_hash=$1',[cappedToken]),true);
  const absoluteBefore = await scalar('select absolute_expires_at as result from public.applicant_sessions where token_hash=$1',[b.token]);
  await load(b.token);
  assert.deepEqual(await scalar('select absolute_expires_at as result from public.applicant_sessions where token_hash=$1',[b.token]),absoluteBefore);
  await q('select public.logout_voucher_session($1)',[b.token]); await q('select public.logout_voucher_session($1)',[b.token]);
  for (const call of calls) await reject('select public.'+call.replace('null',"'"+b.token+"'"),[],'28000');
  const mismatched = await fixture(ids.owner);
  await q('insert into public.applications(user_id,job_id,voucher_id) values($1,$2,$3)',[otherOwner,ids.job,mismatched.voucher]);
  await reject('select public.load_voucher_portal($1)',[mismatched.token]);
  await reject('select public.redeem_portal_voucher($1,$2)',[mismatched.token,ids.job]);
  assert.deepEqual(await q('select to_jsonb(a) as row from public.applications a where id=$1',[ids.application]),baseRows);
  pass('Each operation fails closed after logout; suspension, principal disable, credential rotation, access revoke and idle/absolute expiry deny scope; refresh capped at fixed lifetime; inconsistent application ownership fails closed; baseline application preserved');
  try { await db.exec(sql); assert.fail('Rerun must fail atomically'); }
  catch(error) { assert.equal((error as {code?:string}).code,'42723'); await db.exec('rollback'); }
  pass('Accidental migration rerun fails atomically');
  await writeFile('test-results/voucher-portal-0010-local.json',JSON.stringify({filename,sqlSha256:createHash('sha256').update(sql).digest('hex'),version:await scalar('select version() as result'),checks,limitations:['Local PostgreSQL with mocked Supabase auth/storage only; no hosted execution','Single embedded connection: true concurrent races await hosted disposable-fixture tests','No browser portal hookup, file-byte transport, guest checkout or authentication cutover']},null,2));
}

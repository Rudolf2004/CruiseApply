import assert from 'node:assert/strict';
import { readFile,readdir,writeFile } from 'node:fs/promises';
import { createHash,randomUUID } from 'node:crypto';
import { PGlite } from '../test-results/sql-review/node_modules/@electric-sql/pglite/dist/index.js';
import { pgcrypto } from '../test-results/sql-review/node_modules/@electric-sql/pglite/dist/contrib/pgcrypto.js';
// Deliberately no env file, network client, or hosted database connection.
const db = new PGlite({ extensions: { pgcrypto } });
const report: string[] = [];
const pass = (s: string) => { report.push(s); console.log('PASS: '+s); };
const q = async (sql: string,params: unknown[] = []) => (await db.query(sql,params)).rows as Record<string,unknown>[];
async function rejects(sql: string,code: string,params: unknown[] = []) {
  try { await db.query(sql,params); assert.fail('Expected SQL rejection: '+code); }
  catch(error) { assert.equal((error as {code?:string}).code,code); }
}
const hash = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const owner = randomUUID(),staff = randomUUID(),job = randomUUID(),payment = randomUUID(),voucher = randomUUID(),application = randomUUID(),notice = randomUUID();
const tables = ['applicant_principals','guest_checkouts','voucher_access','applicant_sessions','voucher_contacts','voucher_contact_challenges','voucher_credential_deliveries','applicant_notification_links'];
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage; create schema extensions;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(bucket_id text,name text,metadata jsonb default '{}',primary key(bucket_id,name));
    grant usage on schema public,auth,storage to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;`);
  const names = (await readdir('supabase/migrations')).filter(n => n.endsWith('.sql')).sort();
  const filename = '202610020008_voucher_auth_expansion.sql';
  for (const name of names.filter(n => n < filename)) await db.exec(await readFile('supabase/migrations/'+name,'utf8'));
  pass('Migrations 0001-0007 executed unchanged in local PostgreSQL with pgcrypto and mocked Supabase auth/storage schemas');
  await db.query('insert into auth.users(id,email) values ($1,$2),($3,$4)',[owner,'local-owner@example.invalid',staff,'local-staff@example.invalid']);
  await db.query("update public.profiles set role='admin' where id=$1",[staff]);
  const product = (await q("select id from public.voucher_types where code='application-access'"))[0].id;
  await db.query("update public.voucher_types set amount=15000,active=true where id=$1",[product]);
  await db.query(`insert into public.jobs(id,title,slug,category,department,summary,description,location,contract_duration,status,opportunity_type,service_description)
    values($1,'Local SQL test','local-sql-test','Hospitality','Guest','Local test only','Local test only','Worldwide','Local fixture','published','managed','Local isolated schema verification, not a real employer vacancy or opportunity.')`,[job]);
  await db.query(`insert into public.payments(id,user_id,reference,voucher_type_id,amount,currency,validity_days,customer_email,status,provider_id,paid_at)
    values($1,$2,'LOCAL-PAID',$3,15000,'GHS',90,'local-owner@example.invalid','successful','12345',now())`,[payment,owner,product]);
  await db.query(`insert into public.vouchers(id,user_id,payment_id,voucher_type_id,serial,pin_hash,pin_encrypted,status,expires_at)
    values($1,$2,$3,$4,'LOCAL-USED','s1:'||repeat('a',32)||':'||repeat('b',64),'LOCAL-LEGACY-CIPHERTEXT','used',now()-interval '1 day')`,[voucher,owner,payment,product]);
  await db.query(`insert into public.applications(id,user_id,job_id,voucher_id,reference) values($1,$2,$3,$4,'LOCAL-APP')`,[application,owner,job,voucher]);
  await db.query(`insert into public.notifications(id,user_id,title,body) values($1,$2,'Voucher ready','Local fixture')`,[notice,owner]);
  const oldTables = (await q("select tablename from pg_tables where schemaname='public' order by tablename")).map(r => String(r.tablename));
  async function dataDigest() {
    const all=[];for(const table of oldTables) all.push(await q(`select to_jsonb(t) - array['applicant_id','guest_checkout_id','actor_applicant_id'] as row from public.${table} t order by (to_jsonb(t) - array['applicant_id','guest_checkout_id','actor_applicant_id'])::text`));return hash(all);
  }
  async function policies() { return hash(await q("select * from pg_policies where schemaname='public' order by tablename,policyname")); }
  const oldFunctions = await q("select p.oid,pg_get_functiondef(p.oid) as definition,p.proacl::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by p.oid");
  const oldGrants = await q("select relname,relacl::text from pg_class where oid=any($1::regclass[]) order by relname",[oldTables.map(t=>'public.'+t)]);
  const before = await dataDigest(), policyBefore = await policies();
  const sql = await readFile('supabase/migrations/'+filename,'utf8');
  // Fail immediately before COMMIT: all schema/grants/triggers must roll back.
  try { await db.exec(sql.replace(/commit;\s*$/i,'select 1/0;\ncommit;')); assert.fail('Injected failure did not fail'); }
  catch(error) { assert.equal((error as {code?:string}).code,'22012'); await db.exec('rollback;'); }
  assert.equal((await q("select to_regclass('public.voucher_access') as t"))[0].t,null);
  assert.equal((await q("select count(*)::int as n from information_schema.columns where table_schema='public' and column_name='applicant_id'"))[0].n,0);
  assert.equal(await dataDigest(),before);assert.equal(await policies(),policyBefore);
  pass('Injected late failure rolled back new tables/columns/triggers/grants and preserved legacy data/policies');
  await db.exec(sql);
  const catalogReport = await db.exec(await readFile('supabase/configuration/verify-0008-readonly.sql', 'utf8'));
  const catalog = catalogReport.flatMap(result => result.rows).find(row => 'verification_0008' in row)?.verification_0008 as { private_tables: unknown[]; guards: unknown[] };
  assert.equal(catalog.private_tables.length, 8);
  assert.equal(catalog.guards.length, 8);
  await writeFile('test-results/voucher-auth-0008-local-catalog.json', JSON.stringify(catalog, null, 2));
  pass('Read-only hosted catalog query executes locally and reports all eight tables and guards');
  assert.equal(await dataDigest(),before);assert.equal(await policies(),policyBefore);
  assert.deepEqual(await q("select relname,relacl::text from pg_class where oid=any($1::regclass[]) order by relname",[oldTables.map(t=>'public.'+t)]),oldGrants);
  for(const fn of oldFunctions) assert.deepEqual((await q('select p.oid,pg_get_functiondef(p.oid) as definition,p.proacl::text from pg_proc p where p.oid=$1',[fn.oid]))[0],fn);
  pass('Exact corrected 0008 executes; legacy business values, policies and existing function definitions/ACLs unchanged');
  for (const table of tables) {
    assert.equal((await q(`select count(*)::int as n from public.${table}`))[0].n,0);
    assert.equal((await q('select relrowsecurity from pg_class where oid=$1::regclass',['public.'+table]))[0].relrowsecurity,true);
    for(const privilege of ['SELECT','INSERT','UPDATE','DELETE']) assert.equal((await q('select has_table_privilege($1,$2,$3) as allowed',['service_role','public.'+table,privilege]))[0].allowed,true);
    for(const privilege of ['TRUNCATE','REFERENCES','TRIGGER']) assert.equal((await q('select has_table_privilege($1,$2,$3) as allowed',['service_role','public.'+table,privilege]))[0].allowed,false);
    assert.equal((await q("select count(*)::int as n from pg_class c, lateral aclexplode(c.relacl) a where c.oid=$1::regclass and a.grantee=0",['public.'+table]))[0].n,0);
    for(const role of ['anon','authenticated']) {
      for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) assert.equal((await q('select has_table_privilege($1,$2,$3) as allowed',[role,'public.'+table,privilege]))[0].allowed,false);
      await db.exec('set role '+role);await rejects(`select * from public.${table}`,'42501');await db.exec('reset role');
    }
  }
  assert.equal((await q("select count(*)::int as n from pg_policies where schemaname='public' and tablename=any($1::text[])",[tables]))[0].n,0);
  const newFunctions = await q("select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and not(p.oid=any($1::oid[]))",[oldFunctions.map(f=>f.oid)]);
  assert.equal(newFunctions.length,8);
  for(const fn of newFunctions) for(const role of ['anon','authenticated','service_role']) assert.equal((await q('select has_function_privilege($1,$2::oid,\'EXECUTE\') as allowed',[role,fn.oid]))[0].allowed,false);
  pass('All eight new tables empty/RLS-enabled; every browser table privilege denied; eight new trigger functions not directly executable');
  const owners=['payment_quotes','payments','vouchers','applicants','applications','application_documents','notifications'];
  for(const table of owners) { const c=await q("select column_name,is_nullable from information_schema.columns where table_schema='public' and table_name=$1 and column_name in ('user_id','applicant_id') order by column_name",[table]);assert.deepEqual(c,[{column_name:'applicant_id',is_nullable:'YES'},{column_name:'user_id',is_nullable:'NO'}]); }
  const principal=randomUUID(),other=randomUUID(),checkout=randomUUID(),access=randomUUID(),contact=randomUUID(),delivery=randomUUID();
  await db.query('insert into public.applicant_principals(id) values($1),($2)',[principal,other]);
  await db.query(`insert into public.guest_checkouts(id,applicant_id,capability_hash,contact_email,country_code,expires_at) values($1,$2,repeat('1',64),'shared@example.invalid','GH',now()+interval '1 day')`,[checkout,principal]);
  await rejects('update public.guest_checkouts set applicant_id=$1 where id=$2','P0001',[other,checkout]);
  await rejects(`insert into public.guest_checkouts(applicant_id,capability_hash,contact_email,country_code,expires_at) values($1,'raw-token','shared@example.invalid','GH',now()+interval '1 day')`,'23514',[other]);
  await rejects('insert into public.notifications(user_id,applicant_id,title,body) values($1,$2,\'x\',\'y\')','23514',[owner,principal]);
  await rejects('insert into public.notifications(applicant_id,title,body) values($1,\'x\',\'y\')','23502',[principal]);
  await rejects('delete from public.applicant_principals where id=$1','23503',[principal]);
  await db.query(`insert into public.voucher_access(id,voucher_id,applicant_id,legacy_user_id,credential_state) values($1,$2,$3,$4,'legacy')`,[access,voucher,principal,owner]);
  await rejects(`insert into public.voucher_access(voucher_id,applicant_id,legacy_user_id,credential_state) values($1,$2,$3,'legacy')`,'23505',[voucher,other,owner]);
  await rejects(`update public.voucher_access set legacy_user_id=$1 where id=$2`,'P0001',[staff,access]);
  await db.query(`insert into public.voucher_contacts(id,voucher_access_id,email) values($1,$2,'shared@example.invalid')`,[contact,access]);
  await rejects("update public.voucher_contacts set email='another@example.invalid' where id=$1",'P0001',[contact]);
  await db.query(`insert into public.voucher_credential_deliveries(id,voucher_access_id,guest_checkout_id,capability_hash,expires_at) values($1,$2,$3,repeat('2',64),now()+interval '1 hour')`,[delivery,access,checkout]);
  await rejects(`insert into public.voucher_credential_deliveries(voucher_access_id,guest_checkout_id,capability_hash,expires_at) values($1,$2,repeat('3',64),now()+interval '1 hour')`,'23505',[access,checkout]);
  await db.query('update public.voucher_credential_deliveries set consumed_at=clock_timestamp() where id=$1',[delivery]);
  await rejects('update public.voucher_credential_deliveries set consumed_at=null where id=$1','P0001',[delivery]);
  await rejects("update public.voucher_credential_deliveries set consumed_at=consumed_at+interval '1 second' where id=$1",'P0001',[delivery]);
  await rejects('update public.voucher_credential_deliveries set id=$1 where id=$2','P0001',[randomUUID(),delivery]);
  await rejects(`update public.voucher_access set pin_hash='plaintext-pin',credential_state='current',credential_version=1,credential_rotated_at=now() where id=$1`,'23514',[access]);
  await db.query(`update public.voucher_access set pin_hash='s1:'||repeat('c',32)||':'||repeat('d',64),credential_state='current',credential_version=1,credential_rotated_at=now() where id=$1`,[access]);
  await rejects(`update public.voucher_access set pin_hash='s1:'||repeat('e',32)||':'||repeat('f',64) where id=$1`,'P0001',[access]);
  pass('Owner NOT NULL/XOR/FKs preserved; immutable checkout/access/delivery scope; duplicate voucher claims and delivery bindings rejected; PIN format/forward-version guards work');
  const session=randomUUID(),expired=randomUUID(),challenge=randomUUID();
  await db.query(`insert into public.applicant_sessions(id,voucher_access_id,token_hash,credential_version) values($1,$2,repeat('4',64),1)`,[session,access]);
  const times=(await q("select extract(epoch from idle_expires_at-created_at)::int as idle,extract(epoch from absolute_expires_at-created_at)::int as absolute from public.applicant_sessions where id=$1",[session]))[0];assert.deepEqual(times,{idle:604800,absolute:2592000});
  await rejects('update public.applicant_sessions set absolute_expires_at=absolute_expires_at+interval \'1 day\' where id=$1','P0001',[session]);
  await db.query(`with t as (select clock_timestamp() as ts) update public.applicant_sessions set last_seen_at=t.ts,idle_expires_at=least(t.ts+interval '168 hours',absolute_expires_at) from t where id=$1`,[session]);
  await db.query('update public.applicant_sessions set revoked_at=now() where id=$1',[session]);
  await rejects('update public.applicant_sessions set revoked_at=null where id=$1','P0001',[session]);
  await db.query(`insert into public.applicant_sessions(id,voucher_access_id,token_hash,credential_version,created_at,last_seen_at,idle_expires_at,absolute_expires_at) values($1,$2,repeat('5',64),1,now()-interval '8 days',now()-interval '8 days',now()-interval '1 day',now()+interval '22 days')`,[expired,access]);
  await rejects(`with t as (select clock_timestamp() as ts) update public.applicant_sessions set last_seen_at=t.ts,idle_expires_at=least(t.ts+interval '168 hours',absolute_expires_at) from t where id=$1`,'P0001',[expired]);
  await db.query(`insert into public.voucher_contact_challenges(id,voucher_access_id,contact_id,contact_version,purpose,token_hash,expires_at) values($1,$2,$3,1,'reset_pin',repeat('6',64),now()+interval '1 hour')`,[challenge,access,contact]);
  await db.query('update public.voucher_contact_challenges set consumed_at=now() where id=$1',[challenge]);
  await rejects('update public.voucher_contact_challenges set consumed_at=null where id=$1','P0001',[challenge]);
  await rejects("update public.voucher_contact_challenges set purpose='verify_contact' where id=$1",'P0001',[challenge]);
  await db.query('insert into public.applicant_notification_links(notification_id,voucher_access_id,application_id) values($1,$2,$3)',[notice,access,application]);
  await rejects('delete from public.voucher_access where id=$1','23503',[access]);
  pass('7-day idle/30-day immutable absolute expiry, revoked/expired refresh denial, challenge immutability and non-cascading reference protection pass');
  // Legacy service-only fulfillment returns the already issued voucher unchanged.
  await db.exec('set role service_role');
  const replay=await q("select public.fulfill_verified_payment('LOCAL-PAID',15000,'GHS','local-owner@example.invalid','12345','unused-test-hash','unused-test-cipher') as id");assert.equal(replay[0].id,voucher);
  await db.query('update public.notifications set read_at=now() where id=$1',[notice]);
  await db.exec('reset role');
  await db.query("update public.applications set status='submitted',submitted_at=now(),declaration_at=now() where id=$1",[application]);
  await db.query("select public.review_application($1,$2,$3,0,'under_review','Local schema compatibility review.')",[randomUUID(),staff,application]);
  await db.query("select public.add_application_note($1,$2,$3,1,'Private local compatibility note.')",[randomUUID(),staff,application]);
  pass('Existing service-role fulfillment replay, notification mark-read, staff review and private-note RPCs still work');
  const fks=await q("select conname,confdeltype from pg_constraint where contype='f' and conrelid=any($1::regclass[])",[tables.map(t=>'public.'+t)]);assert.ok(fks.every(f=>f.confdeltype==='a'));
  try {await db.exec(sql);assert.fail('Reapplying should fail');}catch(error){assert.equal((error as {code?:string}).code,'42P07');await db.exec('rollback;');}
  assert.equal((await q('select count(*)::int as n from public.voucher_access'))[0].n,1);
  pass('New foreign keys use NO ACTION deletion; accidental rerun fails atomically without deleting existing schema/data');
  const version=await q('select version() as version');
  await writeFile('test-results/voucher-auth-0008-local-review.json',JSON.stringify({version:version[0].version,migrationSha256:createHash('sha256').update(sql).digest('hex'),checks:report,limitations:['Supabase auth/storage mocked locally; no hosted access','Single embedded connection: real multi-connection claim-lock races are not tested','Claim/session/reset RPCs are not part of 0008']},null,2));
  if (process.argv.includes('--session-stage')) {
    const { verifySessionStage } = await import('./verify-voucher-session-operations-local.mts');
    await verifySessionStage(db, {access, principal, voucher, owner, application});
  }
  if (process.argv.includes('--portal-stage') || (process.argv.includes('--guest-stage') || (process.argv.includes('--recovery-stage') || (process.argv.includes('--actions-stage') || process.argv.includes('--matching-stage'))))) {
    const { verifyPortalStage } = await import('./verify-voucher-portal-local.mts');
    await verifyPortalStage(db, {voucher, owner, application, staff, job, product: String(product)});
  }
  if ((process.argv.includes('--guest-stage') || (process.argv.includes('--recovery-stage') || (process.argv.includes('--actions-stage') || process.argv.includes('--matching-stage'))))) {
    const { verifyGuestStage } = await import('./verify-guest-checkout-local.mts');
    await verifyGuestStage(db,{owner,staff,job,product:String(product),voucher});
  }
  if((process.argv.includes('--recovery-stage') || (process.argv.includes('--actions-stage') || process.argv.includes('--matching-stage')))) { const {verifyRecoveryStage}=await import('./verify-voucher-recovery-local.mts'); await verifyRecoveryStage(db,{owner,job,product:String(product)}); }
  if((process.argv.includes('--actions-stage') || process.argv.includes('--matching-stage'))) {const {verifyApplicantActions}=await import('./verify-applicant-actions-local.mts');await verifyApplicantActions(db,{owner,staff,job,product:String(product)});}
  if(process.argv.includes('--matching-stage')) {const {verifyMatching}=await import('./verify-matching-local.mts');await verifyMatching(db,{staff,owner});}
  if(process.argv.includes('--administration-stage')) {const {verifyAdministration}=await import('./verify-administration-local.mts');await verifyAdministration(db,{staff,owner,product:String(product)});}
  if(process.argv.includes('--pricing-stage')) {const {verifyPricingControls}=await import('./verify-pricing-controls-local.mts');await verifyPricingControls(db,{staff,owner,product:String(product)});}
} finally { await db.close(); }

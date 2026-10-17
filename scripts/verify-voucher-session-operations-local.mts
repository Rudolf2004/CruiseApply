import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import type { PGlite } from '../test-results/sql-review/node_modules/@electric-sql/pglite/dist/index.js';

// Invoked only by the disposable local PostgreSQL harness. No hosted clients/env.
export async function verifySessionStage(db: PGlite, ids: { access: string; principal: string; voucher: string; owner: string; application: string }) {
  const checks: string[] = [];
  const q = async (sql: string, args: unknown[] = []) => (await db.query(sql,args)).rows as Record<string,unknown>[];
  const token = () => createHash('sha256').update(randomBytes(32)).digest('hex');
  async function reject(sql: string, args: unknown[], code = 'P0001') {
    try { await db.query(sql,args); assert.fail('Expected rejection'); }
    catch (error) { assert.equal((error as {code?: string}).code,code); }
  }
  const sql = await readFile('supabase/migrations/202610020009_voucher_session_operations.sql','utf8');
  const tables = (await q("select tablename from pg_tables where schemaname='public' order by tablename")).map(r=>r.tablename);
  async function snapshot() {
    const rows=[];
    for (const table of tables) rows.push(await q(`select to_jsonb(t) as value from public.${table} t order by to_jsonb(t)::text`));
    return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  }
  const before = await snapshot();
  // Reproduce hosted named-role defaults; PUBLIC-only revocation would fail.
  await db.exec('alter default privileges in schema public grant execute on functions to anon, authenticated, service_role');
  const policies = await q("select * from pg_policies where schemaname='public' order by tablename,policyname");
  const definitions = await q("select p.oid,pg_get_functiondef(p.oid) as definition,p.proacl::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by p.oid");
  try { await db.exec(sql.replace(/commit;\s*$/i,'select 1/0;\ncommit;')); assert.fail('Expected rollback'); }
  catch (error) { assert.equal((error as {code?:string}).code,'22012'); await db.exec('rollback'); }
  assert.equal((await q("select to_regprocedure('public.resolve_voucher_session(text)') as fn"))[0].fn,null);
  assert.equal(await snapshot(),before);
  await db.exec(sql);
  const catalogResults=await db.exec(await readFile('supabase/configuration/verify-0009-readonly.sql','utf8'));
  const catalog=catalogResults.flatMap(r=>r.rows).find(r=>'verification_0009' in r)?.verification_0009 as {functions: {exists:boolean;anon_execute:boolean;authenticated_execute:boolean;service_execute:boolean;security_definer:boolean}[]};
  assert.equal(catalog.functions.length,4);
  for(const fn of catalog.functions) {
    assert.ok(fn.exists && fn.security_definer && fn.service_execute);
    assert.equal(fn.anon_execute,false);assert.equal(fn.authenticated_execute,false);
  }
  await writeFile('test-results/voucher-auth-0009-local-catalog.json',JSON.stringify(catalog,null,2));
  assert.equal(await snapshot(),before);
  assert.deepEqual(await q("select * from pg_policies where schemaname='public' order by tablename,policyname"),policies);
  for (const fn of definitions) assert.deepEqual((await q('select p.oid,pg_get_functiondef(p.oid) as definition,p.proacl::text from pg_proc p where p.oid=$1',[fn.oid]))[0],fn);
  checks.push('0009 executes atomically; injected late failure rolls back; no data/policy/old-function changes during migration');
  const calls = [
    "select * from public.get_voucher_login_material('LOCAL-USED')",
    "select * from public.open_verified_voucher_session('LOCAL-USED',null,0,null)",
    "select * from public.resolve_voucher_session(null)",
    "select public.logout_voucher_session(null)",
  ];
  for (const role of ['anon','authenticated']) {
    await db.exec('set role '+role);
    for (const call of calls) await reject(call,[],'42501');
    await db.exec('reset role');
  }
  checks.push('All four operations deny anon/authenticated execution');
  await db.exec('set role service_role');
  const material=(await q("select * from public.get_voucher_login_material('LOCAL-USED')"))[0];
  assert.equal(material.credential_version,1);
  assert.equal(material.pin_hash,'s1:'+'c'.repeat(32)+':'+'d'.repeat(64));
  const legacyHash='s1:'+'a'.repeat(32)+':'+'b'.repeat(64);
  await reject('select * from public.open_verified_voucher_session($1,$2,$3,$4)',['LOCAL-USED',legacyHash,1,token()]);
  await reject('select * from public.open_verified_voucher_session($1,$2,$3,$4)',['LOCAL-USED',material.pin_hash,0,token()]);
  await reject('select * from public.open_verified_voucher_session($1,$2,$3,$4)',['LOCAL-USED',material.pin_hash,1,'raw-session-token']);
  const firstToken=token(),secondToken=token();
  const open=async(t:string)=>(await q('select * from public.open_verified_voucher_session($1,$2,$3,$4)',['LOCAL-USED',material.pin_hash,1,t]))[0];
  const first=await open(firstToken); await open(secondToken);
  await reject('select * from public.open_verified_voucher_session($1,$2,$3,$4)',['LOCAL-USED',material.pin_hash,1,firstToken],'23505');
  const resolved=(await q('select * from public.resolve_voucher_session($1)',[firstToken]))[0];
  assert.equal(resolved.voucher_id,ids.voucher); assert.equal(resolved.applicant_id,ids.principal); assert.equal(resolved.application_id,ids.application);
  assert.equal(new Date(String(resolved.absolute_expires_at)).getTime(),new Date(String(first.absolute_expires_at)).getTime());
  assert.ok(!Object.keys(resolved).some(k=>/pin|token|user_id|email|note/.test(k)));
  assert.equal((await q('select * from public.resolve_voucher_session($1)',[token()])).length,0);
  await q('select public.logout_voucher_session($1)',[firstToken]);
  await q('select public.logout_voucher_session($1)',[firstToken]);
  assert.equal((await q('select * from public.resolve_voucher_session($1)',[firstToken])).length,0);
  assert.equal((await q('select * from public.resolve_voucher_session($1)',[secondToken])).length,1);
  assert.equal((await q("select count(*)::int n from public.audit_logs where action='applicant_session_logged_out' and target_id=$1",[first.session_id]))[0].n,1);
  checks.push('Locked proof/version checks; no legacy fallback after rotation; digest-only tokens; scoped resolution; fixed expiry; isolated/idempotent logout');
  await db.exec('reset role');
  const legacyPayment=randomUUID(),legacyVoucher=randomUUID();
  await db.query(`insert into public.payments(id,user_id,reference,voucher_type_id,amount,currency,validity_days,customer_email,status,provider_id,paid_at)
    select $1,user_id,'LOCAL-SECOND',voucher_type_id,amount,currency,validity_days,customer_email,status,'LOCAL-SECOND',paid_at from public.payments where id=(select payment_id from public.vouchers where id=$2)`,[legacyPayment,ids.voucher]);
  await db.query(`insert into public.vouchers(id,user_id,payment_id,voucher_type_id,serial,pin_hash,pin_encrypted,status,expires_at)
    select $1,user_id,$2,voucher_type_id,'LOCAL-LEGACY',pin_hash,pin_encrypted,'expired',expires_at from public.vouchers where id=$3`,[legacyVoucher,legacyPayment,ids.voucher]);
  const legacyRowBefore=(await q('select to_jsonb(v) as row from public.vouchers v where id=$1',[legacyVoucher]))[0];
  const legacyToken=token();
  await reject('select * from public.open_verified_voucher_session($1,$2,$3,$4)',['LOCAL-LEGACY',material.pin_hash,0,token()]);
  assert.equal((await q('select count(*)::int n from public.voucher_access where voucher_id=$1',[legacyVoucher]))[0].n,0);
  // A token collision must roll back the new principal/access/audit binding too.
  await reject('select * from public.open_verified_voucher_session($1,$2,$3,$4)',['LOCAL-LEGACY',legacyHash,0,secondToken],'23505');
  assert.equal((await q('select count(*)::int n from public.voucher_access where voucher_id=$1',[legacyVoucher]))[0].n,0);
  await db.exec('set role service_role');
  const adopted=(await q('select * from public.open_verified_voucher_session($1,$2,$3,$4)',['LOCAL-LEGACY',legacyHash,0,legacyToken]))[0];
  const again=(await q('select * from public.open_verified_voucher_session($1,$2,$3,$4)',['LOCAL-LEGACY',legacyHash,0,token()]))[0];
  assert.equal(adopted.voucher_access_id,again.voucher_access_id);
  assert.notEqual(adopted.applicant_id,ids.principal);
  assert.equal((await q('select * from public.resolve_voucher_session($1)',[legacyToken]))[0].application_id,null);
  assert.deepEqual((await q('select to_jsonb(v) as row from public.vouchers v where id=$1',[legacyVoucher]))[0],legacyRowBefore);
  await db.exec('reset role');
  checks.push('Explicit legacy proof adoption is atomic and stable; same owner/email does not merge voucher principals; expired unused login grants no application');
  for (const status of ['unused','used','expired','cancelled','refunded']) {
    await db.query('update public.vouchers set status=$1::public.voucher_status where id=$2',[status,legacyVoucher]);
    assert.equal((await q('select * from public.resolve_voucher_session($1)',[legacyToken])).length,1);
    assert.equal((await q('select * from public.open_verified_voucher_session($1,$2,$3,$4)',['LOCAL-LEGACY',legacyHash,0,token()])).length,1);
  }
  await db.query("update public.payments set status='refunded' where id=$1",[legacyPayment]);
  assert.equal((await q('select * from public.open_verified_voucher_session($1,$2,$3,$4)',['LOCAL-LEGACY',legacyHash,0,token()])).length,1);
  const expiryToken=token(),capToken=token(),absoluteToken=token();
  await db.query(`insert into public.applicant_sessions(voucher_access_id,token_hash,credential_version,created_at,last_seen_at,idle_expires_at,absolute_expires_at)
    values($1,$2,1,now()-interval '8 days',now()-interval '8 days',now()-interval '1 day',now()+interval '22 days'),
    ($1,$3,1,now()-interval '29 days',now()-interval '1 day',now()+interval '1 day',now()+interval '1 day'),
    ($1,$4,1,now()-interval '31 days',now()-interval '2 days',now()-interval '1 day',now()-interval '1 day')`,[ids.access,expiryToken,capToken,absoluteToken]);
  assert.equal((await q('select * from public.resolve_voucher_session($1)',[expiryToken])).length,0);
  assert.equal((await q('select * from public.resolve_voucher_session($1)',[absoluteToken])).length,0);
  const capped=(await q('select * from public.resolve_voucher_session($1)',[capToken]))[0];
  assert.deepEqual(capped.idle_expires_at,capped.absolute_expires_at);
  await db.query('update public.voucher_access set suspended_at=now() where id=$1',[ids.access]);
  assert.equal((await q('select * from public.resolve_voucher_session($1)',[secondToken])).length,0);
  await reject('select * from public.open_verified_voucher_session($1,$2,$3,$4)',['LOCAL-USED',material.pin_hash,1,token()]);
  await db.query('update public.voucher_access set suspended_at=null where id=$1',[ids.access]);
  await db.query('update public.applicant_principals set disabled_at=now() where id=$1',[ids.principal]);
  assert.equal((await q('select * from public.resolve_voucher_session($1)',[secondToken])).length,0);
  await db.query('update public.applicant_principals set disabled_at=null where id=$1',[ids.principal]);
  await db.query('update public.voucher_access set credential_version=2 where id=$1',[ids.access]);
  assert.equal((await q('select * from public.resolve_voucher_session($1)',[secondToken])).length,0);
  await db.query('update public.voucher_access set revoked_at=now() where id=$1',[ids.access]);
  assert.equal((await q("select * from public.get_voucher_login_material('LOCAL-USED')")).length,0);
  await q('select public.logout_voucher_session($1)',[secondToken]);
  checks.push('All approved billing/redemption states preserve scoped tracking; idle/absolute expiry, capped refresh, suspension, principal disable, version invalidation and revocation enforced');
  const audits=await q("select metadata,actor_applicant_id,actor_id from public.audit_logs where action in ('voucher_access_bound','applicant_session_opened','applicant_session_logged_out')");
  assert.ok(audits.length>0);
  for (const audit of audits) {assert.deepEqual(audit.metadata,{});assert.ok(audit.actor_applicant_id);assert.equal(audit.actor_id,null);}
  checks.push('Session audit events contain scoped applicant actor and identifiers only; no credential/token metadata');
  const report={checks,sqlSha256:createHash('sha256').update(sql).digest('hex'),limitations:['Single embedded PostgreSQL connection; true concurrent locking not exercised','No HTTP/cookie/scrypt integration or recovery endpoint enabled','All fixtures local; no hosted connection']};
  await writeFile('test-results/voucher-auth-0009-local.json',JSON.stringify(report,null,2));
  for (const check of checks) console.log('PASS 0009: '+check);
}

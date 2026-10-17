import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

// READ ONLY: no RPC calls, authentication mutations, payments or row writes.
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, options);
const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, options);
const tables = ['applicant_principals', 'guest_checkouts', 'voucher_access', 'applicant_sessions', 'voucher_contacts', 'voucher_contact_challenges', 'voucher_credential_deliveries', 'applicant_notification_links'];
const checks: string[] = [];
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function snapshot() {
  // Credentials stay in process memory only; output contains no record bodies.
  const payments = await db.from('payments').select('*').in('reference', ['CA-ccca503b-90ab-4b19-b287-ff5ed3c51176', 'CA-a98a9774-d2b1-46e4-9c17-c7198ed9664b']).order('id');
  assert.equal(payments.error, null); assert.equal(payments.data?.length, 2);
  const paid = payments.data!.find(p => p.reference === 'CA-ccca503b-90ab-4b19-b287-ff5ed3c51176')!;
  const unpaid = payments.data!.find(p => p.id !== paid.id)!;
  assert.equal(paid.status, 'successful'); assert.equal(paid.amount, 15000); assert.equal(paid.currency, 'GHS'); assert.equal(unpaid.status, 'pending');
  const vouchers = await db.from('vouchers').select('*').in('payment_id', payments.data!.map(p => p.id)).order('id');
  assert.equal(vouchers.error, null); assert.equal(vouchers.data?.length, 1);
  const voucher = vouchers.data![0];
  assert.equal(voucher.serial, 'CRV-2026-00000003'); assert.equal(voucher.status, 'used'); assert.equal(voucher.user_id, paid.user_id);
  const applications = await db.from('applications').select('*').eq('voucher_id', voucher.id).order('id');
  assert.equal(applications.error, null); assert.equal(applications.data?.length, 1);
  assert.equal(applications.data![0].reference, 'APP-2026-00000001'); assert.equal(applications.data![0].status, 'submitted'); assert.equal(applications.data![0].user_id, paid.user_id);
  const notifications = await db.from('notifications').select('*').in('user_id', payments.data!.map(p => p.user_id)).order('id');
  assert.equal(notifications.error, null);
  assert.equal(notifications.data!.filter(n => n.user_id === paid.user_id && n.title === 'Voucher ready').length, 1);
  for (const row of [...payments.data!, ...vouchers.data!, ...applications.data!, ...notifications.data!]) assert.equal(row.applicant_id, null);
  const auth = await db.auth.admin.getUserById(paid.user_id);
  assert.equal(auth.error, null); assert.equal(auth.data.user?.id, paid.user_id);
  return digest([payments.data, vouchers.data, applications.data, notifications.data]);
}
try {
  const before = await snapshot();
  for (const table of tables) {
    const result = await db.from(table).select('*', { count: 'exact', head: true });
    assert.equal(result.error, null, table); assert.equal(result.count, 0, table + ' must remain empty');
    const denied = await anon.from(table).select('*').limit(1);
    assert.equal(denied.error?.code, '42501', table + ' must deny anonymous SELECT');
  }
  checks.push('Eight new tables are API-visible to service role, empty, and deny anonymous SELECT');
  for (const table of ['payment_quotes', 'payments', 'vouchers', 'applicants', 'applications', 'application_documents', 'notifications']) {
    const result = await db.from(table).select('applicant_id').limit(1); assert.equal(result.error, null, table);
  }
  for (const table of ['payment_quotes', 'payments']) {
    const result = await db.from(table).select('guest_checkout_id').limit(1); assert.equal(result.error, null, table);
  }
  for (const table of ['application_status_history', 'audit_logs']) {
    const result = await db.from(table).select('actor_applicant_id').limit(1); assert.equal(result.error, null, table);
  }
  checks.push('New owner, checkout and audit actor columns exist through hosted API');
  assert.equal(await snapshot(), before);
  checks.push('Known paid/unpaid transaction states, single used voucher, submitted application and single Voucher ready notification match documented expectations');
  checks.push('Legacy owner Auth user still exists; checked business rows retain legacy ownership and are unchanged across this read-only run');
  const report = { testedAt: new Date().toISOString(), checks, fullHostedVerification: false, limitations: ['Catalog constraints/indexes/RLS/grants require the supplied read-only SQL Editor query', 'No authenticated login/session mutation performed', 'No pre-0008 full-row baseline exists here; before/after equality covers this run, not historical migration execution'] };
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/voucher-auth-0008-hosted-readonly.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  // Avoid assertion dumps of database objects or environment secrets.
  console.error('Read-only verification failed:', error instanceof Error ? error.message.slice(0, 250) : 'Unknown failure');
  process.exitCode = 1;
}

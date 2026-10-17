import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// Hosted database verification only: does not call Paystack or charge anyone.
async function main() {
  assert.ok(process.argv.includes("--confirm-temporary-records"), "Pass --confirm-temporary-records to permit isolated database fixtures.");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert.ok(url && key && serviceKey, "Supabase configuration is required.");
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const db = createClient(url, serviceKey, options);
  const anonymous = createClient(url, key, options);
  const run = randomUUID(); const email = `cruiseapply-payment-test-${run}@example.com`;
  const password = randomUUID() + randomUUID();
  let userId: string | undefined; let typeId: string | undefined; const paymentIds: string[] = [];
  const reference = `CA-${run}`; const limitKey = `integration:${run}`;
  async function clean(table: string, column: string, ids: string[]) {
    if (!ids.length) return;
    const result = await db.from(table).delete().in(column, ids);
    assert.ok(!result.error, `Cleanup failed for ${table}; fixture run ${run}`);
  }
  try {
    const account = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: "Temporary payment verification" } });
    assert.ok(!account.error && account.data.user, "Temporary account creation failed."); userId = account.data.user.id;
    const type = await db.from("voucher_types").insert({ name: `Verification ${run}`, description: "Temporary inactive database test fixture", amount: 137, currency: "GHS", validity_days: 30, active: false }).select("id").single();
    assert.ok(!type.error && type.data, "Temporary voucher type creation failed."); typeId = type.data.id;
    for (const suffix of ["", "-mismatch"]) {
      const payment = await db.from("payments").insert({ user_id: userId, reference: reference + suffix, voucher_type_id: typeId, amount: 137, currency: "GHS", validity_days: 30, customer_email: email }).select("id").single();
      assert.ok(!payment.error && payment.data, "Payment fixture creation failed; check migration 0002."); paymentIds.push(payment.data.id);
    }
    const input = { p_reference: reference, p_amount: 137, p_currency: "GHS", p_email: email, p_provider_id: `fixture-${run}`, p_pin_hash: "test-only-hash", p_pin_encrypted: "test-only-ciphertext" };
    const denied = await anonymous.rpc("fulfill_verified_payment", input);
    assert.ok(denied.error, "Anonymous fulfillment must be denied.");
    const applicant = createClient(url, key, options);
    assert.ok(!(await applicant.auth.signInWithPassword({ email, password })).error, "Fixture sign-in failed.");
    assert.ok((await applicant.rpc("fulfill_verified_payment", input)).error, "Authenticated clients must not fulfill payments.");
    assert.ok((await applicant.rpc("consume_request_limit", { p_key: limitKey, p_limit: 3, p_seconds: 60 })).error, "Clients must not change server rate limits.");
    const mismatch = await db.rpc("fulfill_verified_payment", { ...input, p_reference: reference + "-mismatch", p_amount: 1 });
    assert.ok(mismatch.error, "Mismatched amounts must fail.");
    const untouched = await db.from("payments").select("status").eq("id", paymentIds[1]).single();
    assert.equal(untouched.data?.status, "initialized", "Failed fulfillment must leave payment unchanged.");
    const results = await Promise.all(Array.from({ length: 8 }, () => db.rpc("fulfill_verified_payment", input)));
    assert.ok(results.every(result => !result.error && result.data), "Concurrent fulfillment failed.");
    assert.equal(new Set(results.map(result => result.data)).size, 1, "Concurrent deliveries must return the same voucher.");
    const vouchers = await db.from("vouchers").select("id,pin_hash,expires_at,purchased_at").eq("payment_id", paymentIds[0]);
    assert.equal(vouchers.data?.length, 1, "One payment must issue exactly one voucher.");
    const notices = await db.from("notifications").select("id").eq("user_id", userId);
    assert.equal(notices.data?.length, 1, "Duplicate delivery must not duplicate notifications.");
    assert.ok((await applicant.from("vouchers").select("pin_hash")).error, "PIN hashes must not be readable by clients.");
    const limits = await Promise.all(Array.from({ length: 12 }, () => db.rpc("consume_request_limit", { p_key: limitKey, p_limit: 3, p_seconds: 60 })));
    assert.ok(limits.every(result => !result.error), "Rate-limit operation failed.");
    assert.equal(limits.filter(result => result.data === true).length, 3, "Concurrent limits must admit only the configured count.");
    console.log("PASS: service-only fulfillment, mismatch rollback, 8 concurrent deliveries => 1 voucher and notification, PIN-column restrictions, atomic rate limits.");
  } finally {
    if (userId) {
      const voucherRows = await db.from("vouchers").select("id").eq("user_id", userId);
      const voucherIds = (voucherRows.data ?? []).map(row => row.id);
      await clean("notifications", "user_id", [userId]);
      await clean("vouchers", "user_id", [userId]);
      await clean("audit_logs", "target_id", voucherIds);
      await clean("payments", "id", paymentIds);
      if (typeId) await clean("voucher_types", "id", [typeId]);
      await clean("audit_logs", "actor_id", [userId]);
      await clean("audit_logs", "target_id", [userId]);
      assert.ok(!(await db.auth.admin.deleteUser(userId)).error, `Temporary account cleanup failed: ${userId}`);
      await clean("audit_logs", "target_id", [userId]);
    }
    await clean("request_limits", "key", [limitKey]);
    console.log("Temporary payment fixtures removed.");
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Payment verification failed."); process.exitCode = 1; });

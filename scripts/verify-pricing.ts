import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// Isolated hosted fixtures only. Never edits the real product or existing mappings,
// never initializes Paystack, and never applies migrations.
async function main() {
  assert.ok(process.argv.includes("--confirm-temporary-records"), "Pass --confirm-temporary-records to permit isolated fixtures.");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert.ok(url && key && serviceKey, "Supabase configuration is required.");
  const settings = { auth: { persistSession: false, autoRefreshToken: false } };
  const db = createClient(url, serviceKey, settings);
  const run = randomUUID(); let ownerId: string | undefined; let productId: string | undefined; let regionId: string | undefined;
  let ownsCurrency = false; const countries: string[] = [];
  const email = `cruiseapply-pricing-test-${run}@example.com`; const password = randomUUID() + randomUUID();
  async function remove(table: string, column: string, ids: string[]) {
    if (!ids.length) return;
    assert.ok(!(await db.from(table).delete().in(column, ids)).error, `Fixture cleanup failed: ${table}, run ${run}`);
  }
  const realProduct = await db.from("voucher_types").select("id,amount,currency,active,validity_days").eq("code", "application-access").single();
  assert.ok(!realProduct.error && realProduct.data, "Migration 0003 is required.");
  assert.equal(realProduct.data.amount, null, "The real product should still have no configured price.");
  assert.equal(realProduct.data.active, false, "The real product should remain inactive.");
  try {
    const account = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: "Temporary pricing verification" } });
    assert.ok(!account.error && account.data.user, "Fixture account creation failed."); ownerId = account.data.user.id;
    // XTS is an ISO testing currency; XA/XB are reserved user-assigned regions.
    const currency = await db.from("pricing_currencies").insert({ code: "XTS", minor_units: 2 });
    assert.ok(!currency.error, "XTS is already configured or fixture currency creation failed; no existing row was changed."); ownsCurrency = true;
    const region = await db.from("pricing_regions").insert({ code: `test-${run}`, name: "Temporary pricing verification", display_currency: "XTS" }).select("id").single();
    assert.ok(!region.error && region.data, "Region fixture failed."); regionId = region.data.id;
    for (const code of ["XA", "XB"]) {
      const country = await db.from("pricing_countries").insert({ code, name: `Temporary test ${run}`, region_id: code === "XA" ? regionId : null });
      assert.ok(!country.error, `Country fixture ${code} unavailable; no existing row was changed.`); countries.push(code);
    }
    const product = await db.from("voucher_types").insert({ code: `test-${run}`, name: "Temporary pricing verification", description: "Disposable test fixture", amount: 5000, currency: "GHS", validity_days: 90, active: true }).select("id").single();
    assert.ok(!product.error && product.data, "Product fixture failed."); productId = product.data.id;
    const rate = await db.from("pricing_exchange_rates").insert({ quote_currency: "XTS", rate: 0.5, source: "isolated test fixture", as_of: new Date(Date.now() - 60000).toISOString(), valid_until: new Date(Date.now() + 3600000).toISOString() });
    assert.ok(!rate.error, "Rate fixture failed.");
    const regional = await db.from("voucher_price_overrides").insert({ voucher_type_id: productId, region_id: regionId, charge_amount: 6000 });
    assert.ok(!regional.error, "Region override fixture failed.");
    async function quote(country = "XA") {
      const result = await db.rpc("quote_voucher_price", { p_user_id: ownerId, p_type_id: productId, p_country_code: country });
      assert.ok(!result.error && result.data, `Quote operation failed: ${result.error?.message ?? "missing result"}`); return result.data;
    }
    const regionQuote = await quote();
    assert.equal(regionQuote.charge_amount, 6000); assert.equal(regionQuote.price_source, "region");
    assert.equal(regionQuote.display_amount, 3000); assert.equal(regionQuote.display_currency, "XTS");
    const fallback = await quote("XB");
    assert.equal(fallback.charge_amount, 5000); assert.equal(fallback.display_amount, 5000); assert.equal(fallback.display_currency, "GHS");
    assert.equal(fallback.exchange_rate, null);
    assert.ok(!(await db.from("voucher_price_overrides").insert({ voucher_type_id: productId, country_code: "XA", charge_amount: 5500 })).error);
    const countryQuote = await quote();
    assert.equal(countryQuote.charge_amount, 5500); assert.equal(countryQuote.price_source, "country");
    assert.equal(countryQuote.display_amount, 2750); assert.equal(countryQuote.charge_currency, "GHS");
    assert.ok(!(await db.from("pricing_exchange_rates").update({ rate: 0.75 }).eq("quote_currency", "XTS")).error);
    assert.ok(!(await db.from("voucher_types").update({ amount: 9000 }).eq("id", productId)).error);
    const applicant = createClient(url, key, settings);
    assert.ok(!(await applicant.auth.signInWithPassword({ email, password })).error);
    assert.ok((await applicant.rpc("quote_voucher_price", { p_user_id: ownerId, p_type_id: productId, p_country_code: "XA" })).error, "Clients must not quote directly.");
    assert.ok((await applicant.from("payment_quotes").select("*")).error, "Clients must not read raw quote records.");
    const calls = await Promise.all(Array.from({ length: 6 }, () => db.rpc("create_payment_from_quote", { p_user_id: ownerId, p_quote_id: countryQuote.id, p_reference: `SQL-TEST-${randomUUID()}`, p_job_id: null })));
    assert.ok(calls.every(result => !result.error && result.data), `Quote initialization failed: ${calls.find(result => result.error)?.error?.message ?? "missing result"}`);
    assert.equal(new Set(calls.map(result => result.data.id)).size, 1, "One quote must create only one payment.");
    const payment = calls[0].data;
    assert.equal(payment.charge_amount, 5500); assert.equal(payment.charge_currency, "GHS");
    assert.equal(payment.display_amount, 2750); assert.equal(payment.exchange_rate, 0.5);
    assert.equal(payment.customer_email, email); assert.equal(payment.validity_days, 90);
    assert.ok((await db.from("payments").update({ amount: 1 }).eq("id", payment.id)).error, "Payment price snapshots must be immutable.");
    assert.ok((await db.from("payment_quotes").update({ charge_amount: 1 }).eq("id", countryQuote.id)).error, "Quotes must be immutable.");
    assert.ok(!(await db.from("payments").update({ status: "pending" }).eq("id", payment.id)).error, "Payment status must still be mutable.");
    const foreign = await db.rpc("create_payment_from_quote", { p_user_id: randomUUID(), p_quote_id: countryQuote.id, p_reference: `SQL-TEST-${randomUUID()}` });
    assert.ok(foreign.error, "Foreign quote ownership must be rejected.");
    const expired = { ...fallback, id: randomUUID(), created_at: new Date(Date.now() - 120000).toISOString(), expires_at: new Date(Date.now() - 60000).toISOString() };
    assert.ok(!(await db.from("payment_quotes").insert(expired)).error);
    assert.ok((await db.rpc("create_payment_from_quote", { p_user_id: ownerId, p_quote_id: expired.id, p_reference: `SQL-TEST-${randomUUID()}` })).error, "Expired quotes must not create payments.");
    assert.ok(!(await db.from("pricing_exchange_rates").update({ as_of: new Date(Date.now() - 120000).toISOString(), valid_until: new Date(Date.now() - 60000).toISOString() }).eq("quote_currency", "XTS")).error);
    const stale = await quote();
    assert.equal(stale.display_currency, "GHS"); assert.equal(stale.display_amount, 5500); assert.equal(stale.exchange_rate, null);
    assert.ok(!(await db.from("voucher_types").update({ active: false }).eq("id", productId)).error);
    assert.ok((await db.rpc("quote_voucher_price", { p_user_id: ownerId, p_type_id: productId, p_country_code: "XA" })).error, "Inactive products must not be quoted.");
    console.log("PASS: regional/country precedence, GHS charge and local display separation, missing/stale FX fallback, immutable snapshots, quote ownership/expiry, and six concurrent initializations producing one payment.");
  } finally {
    if (ownerId) { await remove("payments", "user_id", [ownerId]); await remove("payment_quotes", "user_id", [ownerId]); }
    if (productId) { await remove("voucher_price_overrides", "voucher_type_id", [productId]); await remove("voucher_types", "id", [productId]); }
    await remove("pricing_countries", "code", countries);
    if (regionId) await remove("pricing_regions", "id", [regionId]);
    if (ownsCurrency) { await remove("pricing_exchange_rates", "quote_currency", ["XTS"]); await remove("pricing_currencies", "code", ["XTS"]); }
    if (ownerId) {
      await remove("audit_logs", "actor_id", [ownerId]); await remove("audit_logs", "target_id", [ownerId]);
      assert.ok(!(await db.auth.admin.deleteUser(ownerId)).error, `Temporary account cleanup failed: ${ownerId}`);
      await remove("audit_logs", "target_id", [ownerId]);
    }
    const unchanged = await db.from("voucher_types").select("id,amount,currency,active,validity_days").eq("code", "application-access").single();
    assert.deepEqual(unchanged.data, realProduct.data, "The actual product must remain unchanged.");
    console.log("Temporary pricing fixtures removed; actual product remains unpriced and inactive.");
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Pricing verification failed."); process.exitCode = 1; });

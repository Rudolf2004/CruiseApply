import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { paystack, assertVerifiedPayment } from "../src/features/payments/provider.ts";
import { createVoucherCredentials } from "../src/lib/voucher-credentials.ts";
const reference = "CA-a98a9774-d2b1-46e4-9c17-c7198ed9664b";
assert.ok(process.env.PAYSTACK_SECRET_KEY?.startsWith("sk_test_"), "Test key required.");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const result = await db.from("payments").select("id,reference,user_id,status,amount,currency,customer_email,provider_id,validity_days,quote_id").eq("reference", reference).single();
assert.ok(!result.error && result.data, "Existing payment lookup failed.");
const payment = result.data;
console.log("Hosted payment", { reference, status: payment.status, amount: payment.amount, currency: payment.currency, providerId: payment.provider_id, validityDays: payment.validity_days, hasQuote: Boolean(payment.quote_id) });
try {
  const transaction = await paystack.verify(reference);
  console.log("Paystack verification", { reference: transaction.reference, status: transaction.status, amount: transaction.amount, currency: transaction.currency, domain: transaction.domain, id: transaction.id, emailMatches: transaction.email.toLowerCase() === payment.customer_email.toLowerCase() });
  assertVerifiedPayment(transaction, payment);
  console.log("PASS: all provider verification comparisons.");
} catch (error) { console.log("Provider stage error", error instanceof Error ? error.message : "Unknown error"); }
try { await createVoucherCredentials(); console.log("PASS: credential generation/encryption (credentials not logged or stored)."); }
catch (error) { console.log("Credential stage error", error instanceof Error ? error.message : "Unknown error"); }
const vouchers = await db.from("vouchers").select("id,status", { count: "exact" }).eq("payment_id", payment.id);
const limits = await db.from("request_limits").select("attempts,window_start").eq("key", `verify:${payment.user_id}`).maybeSingle();
console.log("Voucher count", vouchers.count, "Rate-limit state", limits.data);
const previousReference = "CA-ccca503b-90ab-4b19-b287-ff5ed3c51176";
const previous = await db.from("payments").select("id,reference,user_id,amount,currency,customer_email,status,provider_id").eq("reference", previousReference).single();
if (!previous.error && previous.data) {
  const verified = await paystack.verify(previousReference);
  if (previous.data.status === "successful") assert.equal(previous.data.provider_id, verified.id, "Stored provider ID must match Paystack.");
  console.log("Stored original provider ID", previous.data.provider_id);
  console.log("Previously supplied checkout", { reference: previousReference, providerStatus: verified.status, domain: verified.domain, amount: verified.amount, currency: verified.currency, providerId: verified.id, sameApplicantAsReportedPayment: previous.data.user_id === payment.user_id, emailMatchesItsOwnPayment: verified.email.toLowerCase() === previous.data.customer_email.toLowerCase(), databaseStatus: previous.data.status });
  const issued = await db.from("vouchers").select("id,serial,status,purchased_at,expires_at", { count: "exact" }).eq("payment_id", previous.data.id);
  const notices = await db.from("notifications").select("id", { count: "exact" }).eq("user_id", previous.data.user_id).eq("title", "Voucher ready");
  console.log("Original checkout fulfillment", { voucherCount: issued.count, voucherNotifications: notices.count, voucher: issued.data?.[0] });
}

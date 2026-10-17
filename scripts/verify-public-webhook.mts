import assert from "node:assert/strict";
import { createHmac,createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
const secret = process.env.PAYSTACK_SECRET_KEY!;
assert.ok(secret?.startsWith("sk_test_"),"Test secret required; Live Mode is forbidden");
const base = process.env.TEST_WEBHOOK_BASE_URL;
assert.ok(base && new URL(base).protocol === "https:","Supply the approved public HTTPS tunnel as TEST_WEBHOOK_BASE_URL");
const endpoint = new URL("/api/payments/webhook",base).href;
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{ auth: { persistSession: false,autoRefreshToken: false } });
const reference = "CA-ccca503b-90ab-4b19-b287-ff5ed3c51176";
const unpaidReference = "CA-a98a9774-d2b1-46e4-9c17-c7198ed9664b";
const headers = { Authorization: "Bearer "+secret };
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function snapshot() {
  const payments = await db.from("payments").select("*").in("reference",[reference,unpaidReference]).order("id"); assert.ok(!payments.error && payments.data?.length === 2);
  const paid = payments.data.find(p => p.reference === reference)!;
  const unpaid = payments.data.find(p => p.reference === unpaidReference)!;
  assert.equal(paid.status,"successful"); assert.equal(paid.amount,15000); assert.equal(paid.currency,"GHS");
  assert.equal(unpaid.status,"pending");
  const vouchers = await db.from("vouchers").select("*").in("payment_id",payments.data.map(p => p.id)).order("id"); assert.ok(!vouchers.error); assert.equal(vouchers.data?.length,1);
  assert.equal(vouchers.data![0].payment_id,paid.id); assert.equal(vouchers.data![0].status,"used"); assert.equal(vouchers.data![0].serial,"CRV-2026-00000003");
  const notifications = await db.from("notifications").select("*").in("user_id",payments.data.map(p => p.user_id)).order("id"); assert.ok(!notifications.error);
  assert.equal(notifications.data!.filter(n => n.user_id === paid.user_id && n.title === "Voucher ready").length,1);
  const applications = await db.from("applications").select("*").eq("voucher_id",vouchers.data![0].id).order("id"); assert.ok(!applications.error); assert.equal(applications.data!.length,1);
  assert.equal(applications.data![0].reference,"APP-2026-00000001");
  // Only a digest leaves this function; credentials and customer data are never logged.
  return { hash: digest([payments.data,vouchers.data,notifications.data,applications.data]),providerId: String(paid.provider_id) };
}
const before = await snapshot();
const checks: { name: string;status: number }[] = [];
async function post(name: string,body: string,signature: string | undefined,expected: number) {
  const response = await fetch(endpoint,{ method: "POST",headers: { "Content-Type": "application/json",...(signature ? { "x-paystack-signature": signature } : {}) },body,signal: AbortSignal.timeout(90000) });
  assert.equal(response.status,expected,name); checks.push({ name,status: response.status });
  if (expected === 200) assert.equal((await response.json()).received,true);
}
const sign = (raw: string) => createHmac("sha512",secret).update(raw).digest("hex");
const success = JSON.stringify({ event: "charge.success",data: { reference } });
const forged = JSON.stringify({ event: "charge.success",data: { reference: unpaidReference,status: "success",amount: 15000,currency: "GHS",domain: "test" } });
try {
  await post("missing signature",forged,undefined,401);
  await post("malformed signature",forged,"not-a-signature",401);
  await post("wrong-secret signature",forged,createHmac("sha512","not-the-merchant-secret").update(forged).digest("hex"),401);
  await post("raw-body tampering",forged+" ",sign(forged),401);
  await post("signed malformed JSON","{",sign("{"),400);
  await post("signed missing reference",JSON.stringify({ event: "charge.success",data: {} }),sign(JSON.stringify({ event: "charge.success",data: {} })),400);
  const ignored = JSON.stringify({ event: "unhandled.test",data: {} }); await post("unhandled event acknowledgement",ignored,sign(ignored),200);
  const verify = await fetch("https://api.paystack.co/transaction/verify/"+reference,{ headers,signal: AbortSignal.timeout(20000) });
  const verified = await verify.json(); assert.equal(verify.status,200); assert.equal(verified.data?.domain,"test"); assert.equal(verified.data?.status,"success"); assert.equal(verified.data?.amount,15000); assert.equal(verified.data?.currency,"GHS"); assert.equal(String(verified.data?.id),before.providerId);
  await post("signed successful existing transaction replay",success,sign(success),200);
  await Promise.all(Array.from({ length: 3 },(_,i) => post("concurrent duplicate "+(i+1),success,sign(success),200)));
  const unpaid = await fetch("https://api.paystack.co/transaction/verify/"+unpaidReference,{ headers,signal: AbortSignal.timeout(20000) }); const unpaidData = await unpaid.json();
  assert.equal(unpaid.status,200); assert.equal(unpaidData.data?.domain,"test"); assert.notEqual(unpaidData.data?.status,"success");
  // Even a correctly signed success-shaped event cannot replace provider verification.
  await post("signed false success for verified unpaid transaction",forged,sign(forged),500);
  const lookup = await fetch("https://api.paystack.co/integration/webhooks/events/lookup?reference="+before.providerId,{ headers,signal: AbortSignal.timeout(20000) }); const event = await lookup.json();
  const list = await fetch("https://api.paystack.co/integration/webhooks/events?category=transactions&event_type=charge.success&category_row_id="+before.providerId,{ headers,signal: AbortSignal.timeout(20000) }); const events = await list.json();
  const delivery = { lookupHttp: lookup.status,lookupFound: !!event.data,listHttp: list.status,matchingEvents: Array.isArray(events.data) ? events.data.length : null };
  assert.equal((await snapshot()).hash,before.hash,"Existing payment/voucher/application/notification records changed");
  await writeFile("test-results/paystack-public-webhook.json",JSON.stringify({ testedAt: new Date().toISOString(),endpoint,reference,checks,delivery,originalRecordsUnchanged: true,newPaymentsCreated: 0,providerDeliveredEventVerified: false },null,2));
  console.log(JSON.stringify({ checks,delivery,originalRecordsUnchanged: true,newPaymentsCreated: 0,providerDeliveredEventVerified: false }));
} finally {
  assert.equal((await snapshot()).hash,before.hash,"Existing records changed during webhook checks");
  console.log("PASS: existing successful and unpaid payment records, used voucher, notification and submitted application unchanged.");
}

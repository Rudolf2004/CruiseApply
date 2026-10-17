import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
const state = JSON.parse(await readFile("test-results/checkout-e2e-state.json","utf8"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{ auth: { persistSession: false,autoRefreshToken: false } });
const voucher = await db.from("vouchers").select("id,status,payment_id").eq("serial","CRV-2026-00000003").eq("user_id",state.id).single();
assert.ok(!voucher.error && voucher.data);
const applications = await db.from("applications").select("id,reference,status,revision,submitted_at,job_id").eq("voucher_id",voucher.data.id).eq("user_id",state.id);
assert.ok(!applications.error);
const app = applications.data[0];
const counts: Record<string,number | null> = {};
if (app) for (const table of ["application_education","application_experience","application_documents","application_matches"]) {
  const result = await db.from(table).select("id",{ count: "exact",head: true }).eq("application_id",app.id); assert.ok(!result.error); counts[table] = result.count;
}
const notices = await db.from("notifications").select("title").eq("user_id",state.id);
const history = app ? await db.from("application_status_history").select("status").eq("application_id",app.id) : null;
const payment = await db.from("payments").select("status,amount,currency").eq("id",voucher.data.payment_id).single();
console.log(JSON.stringify({ voucherStatus: voucher.data.status,payment: payment.data,applicationCount: applications.data.length,application: app,counts,
  notifications: notices.data?.map(n => n.title),history: history?.data?.map(h => h.status) },null,2));

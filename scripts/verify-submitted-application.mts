import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright-core";
const state = JSON.parse(await readFile("test-results/checkout-e2e-state.json","utf8"));
const configuredBase = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const base = process.env.TEST_APP_URL || configuredBase;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const options = { auth: { persistSession: false,autoRefreshToken: false } };
const db = createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY!,options);
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const voucher = await db.from("vouchers").select("id,status,payment_id").eq("serial","CRV-2026-00000003").eq("user_id",state.id).single();
assert.ok(!voucher.error && voucher.data); assert.equal(voucher.data.status,"used");
const applications = await db.from("applications").select("id,reference,status,revision,submitted_at,service_description_snapshot,job_id").eq("voucher_id",voucher.data.id).eq("user_id",state.id);
assert.ok(!applications.error && applications.data?.length === 1);
const app = applications.data[0]; assert.equal(app.status,"submitted"); assert.ok(app.submitted_at);
const document = await db.from("application_documents").select("id").eq("application_id",app.id).eq("user_id",state.id).limit(1).single();
assert.ok(!document.error && document.data);
const browser = await chromium.launch({ channel: "msedge",headless: true }); const temporaryUsers: string[] = [];
const headers = { Origin: new URL(configuredBase).origin };
try {
  const owner = await browser.newContext(); owner.setDefaultTimeout(300000);
  assert.equal((await owner.request.post(`${base}/api/auth/login`,{ headers,data: { email: state.email,password: state.password },timeout: 300000 })).status(),200);
  const replay = await Promise.all([1,2].map(() => owner.request.post(`${base}/api/applications/${app.id}/submit`,{ headers,data: { revision: app.revision,declaration: true },timeout: 300000 })));
  for (const r of replay) {
    if (r.status() !== 200) {
      const contentType = r.headers()["content-type"] || "";
      const error = contentType.includes("application/json") ? (await r.json()).error : "Non-JSON route response";
      assert.fail(`Submission replay returned ${r.status()}: ${error}`);
    }
    assert.equal((await r.json()).reference,app.reference);
  }
  console.log("PASS: original-owner login and two idempotent submission replays."); const page = await owner.newPage();
  await page.goto(`${base}/dashboard/applications/${app.id}`,{ waitUntil: "domcontentloaded",timeout: 300000 });
  await page.getByRole("heading",{ name: "Application history",exact: true }).waitFor();
  assert.match(await page.locator("body").innerText(),/Received by CruiseApply for screening/);
  assert.equal(await page.getByRole("button",{ name: "Submit to CruiseApply" }).count(),0);
  await page.screenshot({ path: "test-results/application-submitted.png",fullPage: true });
  await page.goto(`${base}/dashboard/applications`,{ waitUntil: "domcontentloaded",timeout: 300000 });
  await page.getByText(app.reference,{ exact: true }).waitFor();
  console.log("PASS: submitted owner page, dashboard reference and repeated submission.");
  for (const role of ["applicant","admin"]) {
    const email = `cruiseapply-review-${randomUUID()}@example.com`; const password = randomUUID()+randomUUID();
    const account = await db.auth.admin.createUser({ email,password,email_confirm: true }); assert.ok(!account.error && account.data.user);
    const userId = account.data.user.id; temporaryUsers.push(userId);
    if (role === "admin") assert.ok(!(await db.from("profiles").update({ role: "admin" }).eq("id",userId)).error);
    const other = await browser.newContext(); other.setDefaultTimeout(300000);
    assert.equal((await other.request.post(`${base}/api/auth/login`,{ headers,data: { email,password },timeout: 300000 })).status(),200);
    const foreignPage = await other.request.get(`${base}/dashboard/applications/${app.id}`,{ timeout: 300000 });
    const html = await foreignPage.text();
    assert.ok([200,404].includes(foreignPage.status()));
    assert.match(html,/This page has sailed away/);
    assert.ok(!html.includes("Autosaved integration") && !html.includes("Test institution"),"Applicant details must not leak in streamed HTML.");
    assert.equal((await other.request.get(`${base}/api/applications/${app.id}/documents/${document.data.id}`,{ timeout: 300000 })).status(),404);
    const direct = createClient(url,publicKey,options); assert.ok(!(await direct.auth.signInWithPassword({ email,password })).error);
    const visible = await direct.from("applications").select("id").eq("id",app.id); assert.ok(!visible.error);
    assert.equal(visible.data?.length,role === "admin" ? 1 : 0,"Database role must control RLS access.");
    await direct.auth.signOut({ scope: "local" });
    const adminPage = await other.newPage(); await adminPage.goto(`${base}/admin/applications/${app.id}`,{ waitUntil: "domcontentloaded",timeout: 300000 });
    if (role === "admin") {
      await adminPage.getByRole("heading",{ name: "Employer matching",exact: true }).waitFor();
      const text = await adminPage.locator("body").innerText(); assert.match(text,/No employer assigned/); assert.match(text,/Autosaved integration/);
      await adminPage.screenshot({ path: "test-results/admin-candidate-review.png",fullPage: true });
    } else {
      await adminPage.waitForURL(url => !url.pathname.startsWith("/admin"));
      assert.ok(!(await adminPage.locator("body").innerText()).includes("Autosaved integration"));
    }
    await other.close(); console.log(`PASS: ${role} access boundaries and review routing.`);
  }
  const payment = await db.from("payments").select("status,amount,currency").eq("id",voucher.data.payment_id).single();
  assert.deepEqual(payment.data,{ status: "successful",amount: 15000,currency: "GHS" });
  const count = async (table: string,filter: Record<string,string>) => {
    let query = db.from(table).select("id",{ count: "exact",head: true }); for (const [key,value] of Object.entries(filter)) query = query.eq(key,value);
    const result = await query; assert.ok(!result.error); return result.count;
  };
  assert.equal(await count("vouchers",{ payment_id: voucher.data.payment_id }),1);
  assert.equal(await count("notifications",{ user_id: state.id,title: "Voucher ready" }),1);
  assert.equal(await count("notifications",{ user_id: state.id,title: "Application started" }),1);
  assert.equal(await count("notifications",{ user_id: state.id,title: "Application submitted",href: `/dashboard/applications/${app.id}` }),1);
  assert.equal(await count("application_status_history",{ application_id: app.id,status: "submitted" }),1);
  assert.equal(await count("audit_logs",{ actor_id: state.id,action: "application_submitted",target_id: app.id }),1);
  assert.equal(await count("application_matches",{ application_id: app.id }),0);
  const summary = { reference: app.reference,applicationId: app.id,status: app.status,submittedAt: app.submitted_at,voucher: "CRV-2026-00000003",voucherCount: 1,submissionNotifications: 1,submissionHistory: 1,submissionAudit: 1,employerMatches: 0 };
  await writeFile("test-results/application-e2e-summary.json",JSON.stringify(summary,null,2)); console.log(summary);
} catch (error) {
  console.error("Application verification failed:",error);
  throw error;
} finally {
  await browser.close();
  for (const id of temporaryUsers) {
    for (const column of ["actor_id","target_id"]) {
      const result = await db.from("audit_logs").delete().eq(column,id);
      assert.ok(!result.error,result.error?.message);
    }
    const deleted = await db.auth.admin.deleteUser(id);
    assert.ok(!deleted.error,`Temporary user cleanup failed: ${deleted.error?.message}`);
    const audit = await db.from("audit_logs").delete().eq("target_id",id);
    assert.ok(!audit.error,audit.error?.message);
  }
}

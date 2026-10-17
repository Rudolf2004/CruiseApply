// Requires the explicitly approved test vacancy. Never initializes a payment or
// inserts/updates a voucher/application directly. Retains the submitted test record.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright-core";
import { decryptVoucherPin } from "../src/lib/voucher-credentials.ts";
assert.ok(process.argv.includes("--confirm-approved-managed-intake"),"Explicit test vacancy approval required.");
assert.ok(process.env.PAYSTACK_SECRET_KEY?.startsWith("sk_test_"));
const state = JSON.parse(await readFile("test-results/checkout-e2e-state.json","utf8"));
const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{ auth: { persistSession: false,autoRefreshToken: false } });
const job = await db.from("jobs").select("id,status,sample,company,opportunity_type,required_documents,questions").eq("slug","hospitality-guest-services-candidate-screening").single();
assert.ok(!job.error && job.data?.status === "published" && !job.data.sample,"Approved managed intake must exist and be open.");
assert.equal(job.data.company,null); assert.equal(job.data.opportunity_type,"managed"); assert.deepEqual(job.data.required_documents,[]); assert.deepEqual(job.data.questions,[]);
const voucher = await db.from("vouchers").select("id,pin_encrypted,status").eq("serial","CRV-2026-00000003").eq("user_id",state.id).single();
assert.ok(!voucher.error && voucher.data,"Original-owner voucher required.");
const temporaryUsers: string[] = [];
const browser = await chromium.launch({ channel: "msedge",headless: true });
const context = await browser.newContext({ viewport: { width: 390,height: 844 } });
context.setDefaultTimeout(120000);
const headers = { Origin: new URL(base).origin };
const request = async (path: string,data: unknown,method = "POST") => context.request.fetch(`${base}${path}`,{ method,headers,data,timeout: 120000 });
try {
  assert.equal((await request("/api/auth/login",{ email: state.email,password: state.password })).status(),200);
  const redemption = { serial: "CRV-2026-00000003",pin: decryptVoucherPin(voucher.data.pin_encrypted),jobId: job.data.id };
  const redeems = await Promise.all([request("/api/vouchers/redeem",redemption),request("/api/vouchers/redeem",redemption)]);
  for (const result of redeems) assert.equal(result.status(),200,"Concurrent owner redemption should recover same application.");
  const ids = await Promise.all(redeems.map(async response => (await response.json()).applicationId));
  assert.equal(ids[0],ids[1]); const id = ids[0];
  const root = `/api/applications/${id}`;
  const row = await db.from("applications").select("status,revision").eq("id",id).single();
  assert.equal(row.data?.status,"draft","Runner does not reset completed applications; inspect existing results instead.");
  let revision = row.data.revision;
  const draft = {
    personal: { first_name: "Integration",middle_name: "",surname: "Applicant",date_of_birth: "1995-01-01",nationality: "Ghanaian",country_of_residence: "Ghana",email: state.email,phone: "+233000000000",address: "Internal test address" },
    identification: { passport_available: false,passport_number: "",passport_expiry: "" },
    education: [{ institution: "Test institution",qualification: "Test certificate",field: "Testing",country: "Ghana",start_date: "2015-01-01",completion_date: "2016-01-01" }],
    experience: [{ employer: "Test experience record",position: "Guest support",location: "Test location",start_date: "2020-01-01",end_date: "2021-01-01",responsibilities: "Integration test record only." }],answers: {},
  };
  const saves = await Promise.all([request(root,{ revision,draft },"PATCH"),request(root,{ revision,draft },"PATCH")]);
  assert.deepEqual(saves.map(r => r.status()).sort(),[200,409],"Stale saves must not overwrite.");
  revision = (await saves.find(r => r.status() === 200)!.json()).revision;


  const saved = await request(root,{ revision,draft },"PATCH"); assert.equal(saved.status(),200); revision = (await saved.json()).revision;
  assert.equal((await request(`${root}/submit`,{ revision,declaration: false })).status(),400);

  const upload = async (body: Buffer) => context.request.post(`${base}${root}/documents?${new URLSearchParams({ kind: "cv",name: "internal-test.pdf",revision: String(revision) })}`,{ headers: { ...headers,"Content-Type": "application/pdf" },data: body,timeout: 120000 });
  assert.equal((await upload(Buffer.from("<html>disguised file</html>"))).status(),400);
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF");
  const uploaded = await upload(pdf); assert.equal(uploaded.status(),200,"Private document registration failed.");
  const file = await uploaded.json(); revision = file.revision;
  const download = await context.request.get(`${base}${root}/documents/${file.document.id}`);
  assert.equal(download.status(),200); assert.deepEqual(await download.body(),pdf);
  assert.match(download.headers()["content-disposition"],/^attachment/);
  const anonymous = await browser.newContext();
  assert.equal((await anonymous.request.get(`${base}${root}/documents/${file.document.id}`)).status(),401);
  await anonymous.close();
  const page = await context.newPage();
  await page.goto(`${base}/dashboard/applications/${id}`,{ waitUntil: "domcontentloaded",timeout: 120000 });
  await page.getByRole("heading",{ name: "Personal information",exact: true }).waitFor();
  await page.getByLabel("First name",{ exact: true }).fill("Autosaved integration");
  await page.getByRole("button",{ name: "Save progress",exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Last saved" }).waitFor();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByLabel("First name",{ exact: true }).waitFor();
  assert.equal(await page.getByLabel("First name",{ exact: true }).inputValue(),"Autosaved integration");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
  await page.screenshot({ path: "test-results/application-mobile.png",fullPage: true });
  const current = await db.from("applications").select("revision").eq("id",id).single(); revision = current.data!.revision;
  await page.getByRole("button",{ name: "8. Review",exact: true }).click();
  await page.getByRole("heading",{ name: "Review",exact: true }).waitFor();
  assert.match(await page.locator("main").innerText(),/Test institution/);
  await page.getByRole("button",{ name: "9. Declaration & submit",exact: true }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button",{ name: "Submit to CruiseApply",exact: true }).click();
  await page.getByRole("heading",{ name: "Application history",exact: true }).waitFor({ timeout: 120000 });
  assert.match(await page.locator("main").innerText(),/Received by CruiseApply for screening/);
  const submits = await Promise.all([request(`${root}/submit`,{ revision,declaration: true }),request(`${root}/submit`,{ revision,declaration: true })]);
  for (const result of submits) assert.equal(result.status(),200,"Idempotent submission failed.");
  assert.equal((await request(root,{ revision,draft },"PATCH")).status(),409,"Submitted fields must be read-only.");
  assert.equal((await request(`${root}/documents/${file.document.id}`,{ revision },"DELETE")).status(),409);
  assert.equal((await db.from("applications").select("id",{ count: "exact" }).eq("voucher_id",voucher.data.id)).count,1);
  assert.equal((await db.from("application_status_history").select("id",{ count: "exact" }).eq("application_id",id).eq("status","submitted")).count,1);
  assert.equal((await db.from("notifications").select("id",{ count: "exact" }).eq("user_id",state.id).eq("title","Application submitted").eq("href",`/dashboard/applications/${id}`)).count,1);
  const matches = await db.from("application_matches").select("id",{ count: "exact" }).eq("application_id",id);
  assert.ok(!matches.error); assert.equal(matches.count,0,"Do not invent an employer match.");
  const stored = await db.from("applications").select("opportunity_title_snapshot,service_description_snapshot,status").eq("id",id).single();
  assert.equal(stored.data?.status,"submitted"); assert.ok(stored.data?.service_description_snapshot?.includes("CruiseApply"));
  const malicious = await db.from("applications").update({ service_description_snapshot: "changed" }).eq("id",id);
  assert.ok(malicious.error,"Service snapshots must be immutable even for service writes.");
  for (const role of ["applicant","admin"]) {
    const email = `cruiseapply-review-${randomUUID()}@example.com`; const password = randomUUID()+randomUUID();
    const account = await db.auth.admin.createUser({ email,password,email_confirm: true });
    assert.ok(!account.error && account.data.user); const userId = account.data.user.id; temporaryUsers.push(userId);
    if (role === "admin") assert.ok(!(await db.from("profiles").update({ role: "admin" }).eq("id",userId)).error);
    const other = await browser.newContext();
    assert.equal((await other.request.post(`${base}/api/auth/login`,{ headers,data: { email,password },timeout: 120000 })).status(),200);
    const ownerPage = await other.request.get(`${base}/dashboard/applications/${id}`,{ timeout: 120000 });
    const ownerHtml = await ownerPage.text();
    assert.ok([200,404].includes(ownerPage.status()));
    assert.match(ownerHtml,/This page has sailed away/);
    assert.ok(!ownerHtml.includes("Autosaved integration") && !ownerHtml.includes("Test institution"),"Streamed not-found responses must not expose applicant data.");
    const documentResponse = await other.request.get(`${base}${root}/documents/${file.document.id}`);
    assert.equal(documentResponse.status(),404,"Owner-only document endpoint must not leak to other accounts.");
    const adminPage = await other.newPage(); await adminPage.goto(`${base}/admin/applications/${id}`,{ waitUntil: "domcontentloaded",timeout: 120000 });
    if (role === "admin") {
      await adminPage.getByRole("heading",{ name: "Employer matching",exact: true }).waitFor();
      assert.match(await adminPage.locator("main").innerText(),/No employer assigned/);
      assert.match(await adminPage.locator("main").innerText(),/Autosaved integration/);
    } else assert.ok(!new URL(adminPage.url()).pathname.startsWith("/admin"),"Applicant must not access admin review.");
    await other.close();
  }
  console.log("PASS: concurrent redemption, stale draft conflict, declaration checks, optional-document flow, private upload/download, draft browser resume, mobile layout, repeated submission, frozen edits, one application/history/notification.");
} finally {
  await browser.close();
  for (const userId of temporaryUsers) {
    await db.from("audit_logs").delete().eq("actor_id",userId);
    await db.from("audit_logs").delete().eq("target_id",userId);
    const deleted = await db.auth.admin.deleteUser(userId); assert.ok(!deleted.error,"Temporary account cleanup failed.");
    await db.from("audit_logs").delete().eq("target_id",userId);
  }
  // Genuine owner-approved intake remains published; do not archive it as a fixture.

}

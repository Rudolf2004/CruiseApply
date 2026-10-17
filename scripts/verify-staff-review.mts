import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile,writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright-core";
const options = { auth: { persistSession: false,autoRefreshToken: false } };
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const db = createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY!,options);
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const headers = { Origin: new URL(base).origin };
const state = JSON.parse(await readFile("test-results/checkout-e2e-state.json","utf8"));
const original = await db.from("applications").select("id,status,revision,submitted_at").eq("user_id",state.id).single();
assert.ok(!original.error && original.data);
const appId = randomUUID(),paymentId = randomUUID(),voucherId = randomUUID();
const users: { id: string;email: string;password: string }[] = [];
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
async function check(result: { error: { message: string } | null }) { assert.ok(!result.error,result.error?.message); }
try {
  for (const role of ["applicant","admin"]) {
    const email = `cruiseapply-staff-review-${randomUUID()}@example.com`; const password = randomUUID()+randomUUID();
    const account = await db.auth.admin.createUser({ email,password,email_confirm: true }); assert.ok(!account.error && account.data.user,account.error?.message);
    users.push({ id: account.data.user.id,email,password });
    if (role === "admin") await check(await db.from("profiles").update({ role }).eq("id",account.data.user.id));
  }
  const [owner,staff] = users;
  await writeFile("test-results/staff-review-fixtures.json",JSON.stringify({ appId,paymentId,voucherId,userIds: users.map(u => u.id) }));
  const product = await db.from("voucher_types").select("id").eq("code","application-access").single(); assert.ok(product.data && !product.error);
  const job = await db.from("jobs").select("id").eq("slug","hospitality-guest-services-candidate-screening").single(); assert.ok(job.data && !job.error);
  // Synthetic database fixture only: no provider request, no real purchase or fulfillment.
  await check(await db.from("payments").insert({ id: paymentId,user_id: owner.id,provider: "integration_fixture",reference: "FIXTURE-"+randomUUID(),voucher_type_id: product.data.id,amount: 1,currency: "GHS",validity_days: 90,customer_email: owner.email,status: "initialized" }));
  await check(await db.from("vouchers").insert({ id: voucherId,serial: "FIXTURE-"+randomUUID(),user_id: owner.id,payment_id: paymentId,voucher_type_id: product.data.id,status: "used",pin_hash: randomUUID(),pin_encrypted: randomUUID(),expires_at: new Date(Date.now()+86400000).toISOString() }));
  await check(await db.from("applications").insert({ id: appId,reference: "FIXTURE-"+randomUUID(),user_id: owner.id,job_id: job.data.id,voucher_id: voucherId }));
  const args = { p_request_id: randomUUID(),p_actor_id: staff.id,p_application_id: appId,p_revision: 0,p_status: "under_review",p_message: "Internal review integration fixture." };
  const anon = createClient(url,key,options);
  assert.equal((await anon.rpc("review_application",args)).error?.code,"42501");
  for (const account of users) {
    const client = createClient(url,key,options); await check(await client.auth.signInWithPassword({ email: account.email,password: account.password }));
    assert.equal((await client.rpc("review_application",args)).error?.code,"42501");
    const hidden = await client.from("application_review_commands").select("request_id");
    assert.ok(hidden.error || hidden.data?.length === 0);
    await client.auth.signOut({ scope: "local" });
  }
  assert.equal((await db.rpc("review_application",{ ...args,p_actor_id: owner.id })).error?.message,"Administrator required");
  assert.equal((await db.rpc("review_application",args)).error?.message,"Only submitted applications can be reviewed");
  await check(await db.from("applications").update({ status: "submitted",submitted_at: new Date().toISOString(),declaration_at: new Date().toISOString() }).eq("id",appId));
  for (const status of ["submitted","under_review","additional_information_required","shortlisted","interview","final_review","accepted","unsuccessful","withdrawn"]) {
    await check(await db.from("applications").update({ status }).eq("id",appId));
    assert.equal((await db.rpc("review_application",{ ...args,p_request_id: randomUUID(),p_status: "withdrawn" })).error?.message,"Review transition not permitted");
    if (["accepted","unsuccessful","withdrawn"].includes(status)) assert.equal((await db.rpc("review_application",{ ...args,p_request_id: randomUUID() })).error?.message,"Review transition not permitted");
  }
  await check(await db.from("applications").update({ status: "submitted" }).eq("id",appId));
  assert.equal((await db.rpc("review_application",{ ...args,p_message: "short" })).error?.message,"Invalid review parameters");
  assert.equal((await db.rpc("review_application",{ ...args,p_status: "accepted" })).error?.message,"Review transition not permitted");
  const parallel = await Promise.all(Array.from({ length: 6 },() => db.rpc("review_application",args)));
  parallel.forEach(result => { assert.ok(!result.error,result.error?.message); assert.equal(result.data.revision,1); });
  assert.equal((await db.rpc("review_application",{ ...args,p_message: "Conflicting payload must fail." })).error?.message,"Review request conflict");
  assert.equal((await db.rpc("review_application",{ ...args,p_request_id: randomUUID() })).error?.message,"Revision conflict");
  async function count(table: string,column: string,value: string) { const r = await db.from(table).select("*",{ count: "exact",head: true }).eq(column,value); await check(r); return r.count; }
  assert.equal(await count("application_review_commands","application_id",appId),1);
  assert.equal(await count("application_status_history","application_id",appId),1);
  assert.equal(await count("notifications","user_id",owner.id),1);
  assert.equal(await count("audit_logs","target_id",appId),1);
  const audit = await db.from("audit_logs").select("actor_id,metadata").eq("target_id",appId).single(); assert.equal(audit.data?.actor_id,staff.id); assert.equal(audit.data?.metadata.request_id,args.p_request_id);
  await check(await db.from("profiles").update({ role: "applicant" }).eq("id",staff.id));
  assert.equal((await db.rpc("review_application",args)).error?.message,"Administrator required");
  await check(await db.from("profiles").update({ role: "super_admin" }).eq("id",staff.id));
  const competing = await Promise.all(["shortlisted","additional_information_required"].map(p_status => db.rpc("review_application",{ ...args,p_request_id: randomUUID(),p_revision: 1,p_status })));
  assert.equal(competing.filter(r => !r.error).length,1); assert.equal(competing.find(r => r.error)?.error?.message,"Revision conflict");
  assert.equal(await count("application_status_history","application_id",appId),2);
  assert.equal(await count("notifications","user_id",owner.id),2);
  assert.equal(await count("audit_logs","target_id",appId),2);
  console.log("PASS: service-only/admin authorization; draft, withdrawal, terminal, invalid and stale rejection; six identical retries; competing decisions; exact attributed history/notification/audit counts; role revocation and super-admin.");
  if (process.argv.includes("--rpc-only")) { console.log("RPC-only checks completed."); }
  else {
    browser = await chromium.launch({ channel: "msedge",headless: true,timeout: 300000 });
    const admin = await browser.newContext(); admin.setDefaultTimeout(300000);
    const applicant = await browser.newContext(); applicant.setDefaultTimeout(300000);
    const login = async (context: typeof admin,account: typeof staff) => assert.equal((await context.request.post(base+"/api/auth/login",{ headers,data: { email: account.email,password: account.password },timeout: 300000 })).status(),200);
    await login(admin,staff); await login(applicant,owner);
    const current = await db.from("applications").select("revision,status").eq("id",appId).single(); assert.ok(current.data);
    const body = { requestId: randomUUID(),revision: current.data.revision,status: current.data.status === "shortlisted" ? "interview" : "under_review",message: "Staff browser screening test message." };
    const endpoint = base+"/api/admin/applications/"+appId+"/review";
    const unsigned = await browser.newContext();
    assert.equal((await unsigned.request.post(endpoint,{ headers,data: body })).status(),401); await unsigned.close();
    assert.equal((await applicant.request.post(endpoint,{ headers,data: body })).status(),403);
    assert.equal((await admin.request.post(endpoint,{ headers: { Origin: "https://foreign.example" },data: body })).status(),403);
    assert.equal((await admin.request.post(endpoint,{ headers,data: { ...body,actor_id: owner.id } })).status(),400);
    assert.equal((await admin.request.post(endpoint,{ headers,data: { ...body,status: "withdrawn" } })).status(),400);
    console.log("PASS: staff-session API rejects anonymous/applicant requests, forged actors, withdrawal and foreign origins.");
    const page = await admin.newPage(); await page.goto(base+"/admin/applications/"+appId,{ waitUntil: "domcontentloaded",timeout: 300000 });
    const select = page.getByRole("combobox",{ name: /Screening decision/ }); await select.waitFor();
    assert.equal(await select.locator('option[value="withdrawn"]').count(),0);
    await select.selectOption(body.status); await page.getByLabel("Message visible to the applicant").fill(body.message);
    const decisionResponse = page.waitForResponse(response => response.url() === endpoint && response.request().method() === "POST");
    await page.getByRole("button",{ name: "Record screening decision",exact: true }).click();
    const recorded = await decisionResponse; assert.equal(recorded.status(),200,await recorded.text());
    await page.locator("p").filter({ hasText: body.message }).waitFor();
    assert.equal(await count("application_status_history","application_id",appId),3);
    assert.equal(await count("notifications","user_id",owner.id),3);
    assert.equal(await count("audit_logs","target_id",appId),3);
    const originalDoc = await db.from("application_documents").select("id").eq("application_id",original.data.id).limit(1).single(); assert.ok(originalDoc.data && !originalDoc.error);
    const docEndpoint = base+"/api/admin/applications/"+original.data.id+"/documents/"+originalDoc.data.id;
    assert.equal((await applicant.request.get(docEndpoint)).status(),403);
    const staffDownload = await admin.request.get(docEndpoint); assert.equal(staffDownload.status(),200); assert.match(staffDownload.headers()["content-disposition"],/attachment/);
    const downloadAudit = await db.from("audit_logs").select("actor_id").eq("target_id",originalDoc.data.id).eq("actor_id",staff.id).eq("action","application_document_downloaded");
    assert.ok(!downloadAudit.error); assert.equal(downloadAudit.data?.length,1);
    await page.goto(base+"/admin/applications?status=submitted&q="+encodeURIComponent("APP-"),{ waitUntil: "domcontentloaded",timeout: 300000 });
    await page.getByText("APP-2026-00000001",{ exact: true }).waitFor();
    console.log("PASS: staff queue filtering and separately audited private document access; applicant route permissions unchanged.");
    const candidate = await applicant.newPage(); await candidate.goto(base+"/dashboard/applications/"+appId,{ waitUntil: "domcontentloaded",timeout: 300000 });
    assert.ok(!candidate.url().includes("/login"), "Fixture owner browser unexpectedly redirected to login");
    await candidate.getByText(body.message,{ exact: true }).waitFor({ timeout: 30000 });
    await page.screenshot({ path: "test-results/admin-review-decision.png",fullPage: true });
    const direct = createClient(url,key,options); await check(await direct.auth.signInWithPassword({ email: owner.email,password: owner.password }));
    assert.equal((await direct.from("applications").select("id").eq("id",original.data.id)).data?.length,0); await direct.auth.signOut({ scope: "local" });
    const originalOwner = await browser.newContext(); await login(originalOwner,state);
    const originalPage = await originalOwner.newPage(); await originalPage.goto(base+"/dashboard/applications/"+original.data.id,{ waitUntil: "domcontentloaded",timeout: 300000 });
    await originalPage.getByRole("heading",{ name: "Application history",exact: true }).waitFor({ timeout: 300000 });
    assert.equal(await originalPage.getByRole("button",{ name: "Record screening decision" }).count(),0);
    const originalNow = await db.from("applications").select("id,status,revision,submitted_at").eq("id",original.data.id).single(); assert.deepEqual(originalNow.data,original.data);
    const currentFixture = await db.from("applications").select("status,revision").eq("id",appId).single(); assert.ok(currentFixture.data);
    let finalRevision = currentFixture.data.revision;
    const steps = currentFixture.data.status === "interview" ? ["final_review","accepted"] : ["shortlisted","final_review","accepted"];
    let acceptedArgs = args;
    for (const p_status of steps) {
      acceptedArgs = { ...args,p_request_id: randomUUID(),p_revision: finalRevision,p_status,p_message: "Internal screening decision for the disposable candidate fixture." };
      const result = await db.rpc("review_application",acceptedArgs); await check(result); finalRevision = result.data.revision;
    }
    await check(await db.rpc("review_application",acceptedArgs));
    assert.equal((await db.rpc("review_application",{ ...acceptedArgs,p_request_id: randomUUID(),p_revision: finalRevision,p_status: "under_review" })).error?.message,"Review transition not permitted");
    const acceptedNotice = await db.from("notifications").select("body").eq("user_id",owner.id).order("created_at",{ ascending: false }).limit(1).single();
    assert.ok(!acceptedNotice.error); assert.match(acceptedNotice.data!.body,/Accepted\/qualified through CruiseApply internal screening/); assert.match(acceptedNotice.data!.body,/does not guarantee employer referral/);
    for (const table of ["application_review_commands","application_status_history"]) assert.equal(await count(table,"application_id",appId),3+steps.length);
    assert.equal(await count("notifications","user_id",owner.id),3+steps.length);
    assert.equal(await count("audit_logs","target_id",appId),3+steps.length);
    await candidate.reload({ waitUntil: "domcontentloaded",timeout: 300000 });
    await candidate.getByText(/Accepted\/qualified through CruiseApply's internal screening/).waitFor();
    console.log("PASS: valid progression to internal acceptance, scoped notification/owner wording, terminal rejection and replay counts.");
    console.log("PASS: staff-session API, actor spoofing/origin/applicant denial, browser decision, fixture-owner visibility and original-owner isolation with original state unchanged.");
  }
} catch (error) { console.error("Staff review verification failed:",error); throw error; }
finally {
  if (browser) await browser.close();
  for (const table of ["application_review_commands","application_status_history"]) await check(await db.from(table).delete().eq("application_id",appId));
  await check(await db.from("audit_logs").delete().eq("target_id",appId));
  for (const user of users) await check(await db.from("notifications").delete().eq("user_id",user.id));
  await check(await db.from("applications").delete().eq("id",appId));
  await check(await db.from("vouchers").delete().eq("id",voucherId));
  await check(await db.from("payments").delete().eq("id",paymentId));
  for (const id of [appId,voucherId,paymentId,...users.map(u => u.id)]) await check(await db.from("audit_logs").delete().eq("target_id",id));
  for (const user of users) { await check(await db.from("audit_logs").delete().eq("actor_id",user.id)); await check(await db.auth.admin.deleteUser(user.id)); await check(await db.from("audit_logs").delete().eq("target_id",user.id)); }
  console.log("PASS: synthetic fixtures removed; no Paystack transaction was initialized.");
}

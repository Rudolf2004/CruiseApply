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
const original = await db.from("applications").select("*").eq("user_id",state.id).single();
assert.ok(!original.error && original.data);
const appId = randomUUID(),paymentId = randomUUID(),voucherId = randomUUID();
const users: { id: string;email: string;password: string }[] = [];
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
async function check(result: { error: { message: string } | null }) { assert.ok(!result.error,result.error?.message); }
try {
  for (const role of ["applicant","admin"]) {
    const email = `cruiseapply-staff-notes-${randomUUID()}@example.com`; const password = randomUUID()+randomUUID();
    const account = await db.auth.admin.createUser({ email,password,email_confirm: true }); assert.ok(!account.error && account.data.user,account.error?.message);
    users.push({ id: account.data.user.id,email,password });
    if (role === "admin") await check(await db.from("profiles").update({ role }).eq("id",account.data.user.id));
  }
  const [owner,staff] = users;
  await writeFile("test-results/staff-notes-fixtures.json",JSON.stringify({ appId,paymentId,voucherId,userIds: users.map(u => u.id) }));
  const product = await db.from("voucher_types").select("id").eq("code","application-access").single(); assert.ok(product.data && !product.error);
  const job = await db.from("jobs").select("id").eq("slug","hospitality-guest-services-candidate-screening").single(); assert.ok(job.data && !job.error);
  // Synthetic database fixture only: no provider request, no real purchase or fulfillment.
  await check(await db.from("payments").insert({ id: paymentId,user_id: owner.id,provider: "integration_fixture",reference: "FIXTURE-"+randomUUID(),voucher_type_id: product.data.id,amount: 1,currency: "GHS",validity_days: 90,customer_email: owner.email,status: "initialized" }));
  await check(await db.from("vouchers").insert({ id: voucherId,serial: "FIXTURE-"+randomUUID(),user_id: owner.id,payment_id: paymentId,voucher_type_id: product.data.id,status: "used",pin_hash: randomUUID(),pin_encrypted: randomUUID(),expires_at: new Date(Date.now()+86400000).toISOString() }));
  await check(await db.from("applications").insert({ id: appId,reference: "FIXTURE-"+randomUUID(),user_id: owner.id,job_id: job.data.id,voucher_id: voucherId }));
  const noteId = randomUUID(), privateBody = "PRIVATE-NOTE-"+randomUUID();
  const args = { p_request_id: noteId,p_actor_id: staff.id,p_application_id: appId,p_revision: 0,p_body: privateBody };
  const snapshot = async () => {
    const app = await db.from("applications").select("*").eq("id",appId).single(); await check(app);
    const history = await db.from("application_status_history").select("*").eq("application_id",appId); await check(history);
    const notifications = await db.from("notifications").select("*").eq("user_id",owner.id); await check(notifications);
    const matches = await db.from("application_matches").select("*").eq("application_id",appId); await check(matches);
    return { app: app.data,history: history.data,notifications: notifications.data,matches: matches.data };
  };
  const before = await snapshot();
  const anon = createClient(url,key,options);
  const ownerClient = createClient(url,key,options),staffClient = createClient(url,key,options);
  await check(await ownerClient.auth.signInWithPassword({ email: owner.email,password: owner.password }));
  await check(await staffClient.auth.signInWithPassword({ email: staff.email,password: staff.password }));
  for (const client of [anon,ownerClient,staffClient]) assert.equal((await client.rpc("add_application_note",args)).error?.code,"42501");
  assert.equal((await db.rpc("add_application_note",{ ...args,p_actor_id: owner.id })).error?.message,"Administrator required");
  assert.equal((await db.rpc("add_application_note",{ ...args,p_revision: 1 })).error?.message,"Revision conflict");
  const results = await Promise.all(Array.from({ length: 6 },() => db.rpc("add_application_note",args)));
  for (const result of results) { await check(result); assert.equal(result.data,noteId); }
  for (const patch of [{ p_body: "Conflicting private content" },{ p_revision: 1 }]) assert.equal((await db.rpc("add_application_note",{ ...args,...patch })).error?.message,"Note request conflict");
  async function assertCounts(expected: number) {
    const notes = await db.from("admin_notes").select("id,body,actor_id,context_revision").eq("application_id",appId); await check(notes); assert.equal(notes.data!.length,expected);
    for (const note of notes.data!) {
      assert.equal(note.actor_id,staff.id); assert.equal(note.context_revision,0);
      const audit = await db.from("audit_logs").select("actor_id,action,metadata").eq("target_type","admin_notes").eq("target_id",note.id); await check(audit);
      assert.equal(audit.data!.length,2); assert.equal(audit.data!.filter(row => row.action === "insert").length,1);
      const attributed = audit.data!.filter(row => row.action === "application_note_added"); assert.equal(attributed.length,1); assert.equal(attributed[0].actor_id,staff.id);
      assert.deepEqual(attributed[0].metadata,{ application_id: appId,context_revision: 0,request_id: note.id });
      assert.ok(!JSON.stringify(audit.data).includes(note.body));
    }
    assert.deepEqual(await snapshot(),before,"Notes must not change application, revision, history, notifications or matches");
  }
  await assertCounts(1);
  for (const client of [anon,ownerClient]) {
    const notes = await client.from("admin_notes").select("*").eq("application_id",appId); assert.ok(notes.error || notes.data?.length === 0);
    const byId = await client.from("admin_notes").select("*").eq("id",noteId); assert.ok(byId.error || byId.data?.length === 0);
    const write = await client.from("admin_notes").insert({ id: randomUUID(),application_id: appId,actor_id: owner.id,body: "Unauthorized insertion" }); assert.ok(write.error);
  }
  for (const client of [anon,ownerClient,staffClient]) {
    const changed = await client.from("admin_notes").update({ body: "Unauthorized note overwrite" }).eq("id",noteId).select("id"); assert.ok(changed.error || changed.data?.length === 0);
    const removed = await client.from("admin_notes").delete().eq("id",noteId).select("id"); assert.ok(removed.error || removed.data?.length === 0);
  }
  const embedded = await ownerClient.from("applications").select("id,admin_notes(*)").eq("id",appId).single(); await check(embedded); assert.deepEqual(embedded.data?.admin_notes,[]);
  const staffRead = await staffClient.from("admin_notes").select("body").eq("id",noteId).single(); await check(staffRead); assert.equal(staffRead.data?.body,privateBody);
  assert.ok((await staffClient.from("admin_notes").insert({ id: randomUUID(),application_id: appId,actor_id: staff.id,body: "Direct staff insert must fail" })).error);
  await check(await db.from("profiles").update({ role: "applicant" }).eq("id",staff.id));
  assert.equal((await db.rpc("add_application_note",args)).error?.message,"Administrator required");
  const revoked = await staffClient.from("admin_notes").select("*").eq("id",noteId); assert.ok(revoked.error || revoked.data?.length === 0);
  await check(await db.from("profiles").update({ role: "super_admin" }).eq("id",staff.id));
  await check(await db.rpc("add_application_note",args));
  assert.equal((await staffClient.from("admin_notes").select("id").eq("id",noteId).single()).data?.id,noteId);
  await assertCounts(1);
  console.log("PASS: anonymous/applicant RLS read isolation including embedded relations; staff read and role revocation; service-only writes; six identical retries; conflicts/stale context; two body-free audit events per note; no application side effects.");
  if (!process.argv.includes("--rpc-only")) {
    browser = await chromium.launch({ channel: "msedge",headless: true,timeout: 120000 });
    const admin = await browser.newContext(),applicant = await browser.newContext(),unsigned = await browser.newContext();
    for (const context of [admin,applicant,unsigned]) context.setDefaultTimeout(60000);
    const login = async (context: typeof admin,account: { email: string;password: string }) => assert.equal((await context.request.post(base+"/api/auth/login",{ headers,data: { email: account.email,password: account.password } })).status(),200);
    await login(admin,staff); await login(applicant,owner);
    const endpoint = base+"/api/admin/applications/"+appId+"/notes";
    const body = { requestId: noteId,revision: 0,body: privateBody };
    for (const [context,status] of [[unsigned,401],[applicant,403]] as const) {
      assert.equal((await context.request.get(endpoint)).status(),status);
      assert.equal((await context.request.post(endpoint,{ headers,data: body })).status(),status);
    }
    assert.equal((await admin.request.post(endpoint,{ headers: { Origin: "https://foreign.example" },data: body })).status(),403);
    assert.equal((await admin.request.post(endpoint,{ headers,data: { ...body,actor_id: owner.id } })).status(),400);
    assert.equal((await admin.request.post(endpoint,{ headers,data: { ...body,requestId: randomUUID(),revision: 1 } })).status(),409);
    assert.equal((await admin.request.post(endpoint,{ headers,data: body })).status(),200);
    assert.equal((await admin.request.post(endpoint,{ headers,data: { ...body,body: "Conflicting body through API" } })).status(),409);
    const listed = await admin.request.get(endpoint); assert.equal(listed.status(),200); assert.match(listed.headers()["cache-control"],/no-store/); assert.equal((await listed.json()).notes.length,1);
    const emptyPage = await admin.request.get(endpoint+"?page=2"); assert.equal(emptyPage.status(),200); assert.equal((await emptyPage.json()).notes.length,0);
    for (const context of [unsigned,applicant]) {
      const deniedPage = await context.request.get(base+"/admin/applications/"+appId);
      assert.ok(!(await deniedPage.text()).includes(privateBody));
    }
    const page = await admin.newPage(); await page.goto(base+"/admin/applications/"+appId,{ waitUntil: "domcontentloaded" });
    await page.getByText(privateBody,{ exact: true }).waitFor();
    const browserBody = "PRIVATE-BROWSER-NOTE-"+randomUUID();
    await page.getByLabel("Internal staff note",{ exact: true }).fill(browserBody);
    // Lose the first response after the server commits, then exercise the identical retry.
    let interruptedRequest: unknown;
    await page.route("**/api/admin/applications/*/notes",async route => { interruptedRequest = route.request().postDataJSON(); await route.fetch(); await route.abort("failed"); },{ times: 1 });
    await page.getByRole("button",{ name: "Save internal note",exact: true }).click();
    await page.getByRole("button",{ name: "Retry same note",exact: true }).waitFor();
    await assertCounts(2);
    const retryResponse = page.waitForResponse(response => response.url() === endpoint && response.request().method() === "POST");
    await page.getByRole("button",{ name: "Retry same note",exact: true }).click();
    const response = await retryResponse; assert.equal(response.status(),200); assert.deepEqual(response.request().postDataJSON(),interruptedRequest);
    await page.getByText(browserBody,{ exact: true }).waitFor(); await assertCounts(2);
    await page.setViewportSize({ width: 390,height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: "test-results/staff-notes-mobile.png",fullPage: true });
    for (const path of ["/api/applications/"+appId,"/dashboard/applications/"+appId,"/dashboard","/dashboard/applications","/dashboard/notifications"]) {
      const result = await applicant.request.get(base+path,{ timeout: 180000 }); assert.equal(result.status(),path.startsWith("/api/") ? 405 : 200);
      const content = await result.text(); assert.ok(!content.includes(privateBody) && !content.includes(browserBody));
    }
    const candidate = await applicant.newPage(); await candidate.goto(base+"/dashboard/applications/"+appId,{ waitUntil: "domcontentloaded" });
    assert.ok(!candidate.url().includes("/login")); assert.equal(await candidate.getByLabel("Internal staff note",{ exact: true }).count(),0);
    const content = await candidate.locator("body").innerText(); assert.ok(!content.includes(privateBody) && !content.includes(browserBody));
    const originalOwner = await browser.newContext(); await login(originalOwner,state);
    const originalNotes = await originalOwner.request.get(endpoint); assert.equal(originalNotes.status(),403);
    const originalPage = await originalOwner.request.get(base+"/dashboard/applications/"+original.data.id); assert.equal(originalPage.status(),200); assert.ok(!(await originalPage.text()).includes(privateBody));
    const foreign = await ownerClient.from("applications").select("id").eq("id",original.data.id); await check(foreign); assert.equal(foreign.data!.length,0);
    const unchanged = await db.from("applications").select("*").eq("id",original.data.id).single(); await check(unchanged); assert.deepEqual(unchanged.data,original.data);
    await assertCounts(2);
    console.log("PASS: staff API/editor, lost-response retry, mobile overflow, anonymous/applicant/actor/origin denial, applicant payload/dashboard/notification isolation and original-owner isolation; original application unchanged.");
  }
} catch (error) { const kind = error instanceof Error ? error.name : "UnknownError"; console.error("Staff notes verification failed:",kind); throw new Error("Staff notes verification failed: "+kind); }
finally {
  if (browser) await browser.close();
  const notes = await db.from("admin_notes").select("id").eq("application_id",appId); await check(notes);
  await check(await db.from("admin_notes").delete().eq("application_id",appId));
  for (const note of notes.data ?? []) await check(await db.from("audit_logs").delete().eq("target_id",note.id).eq("target_type","admin_notes"));
  for (const table of ["application_review_commands","application_status_history"]) await check(await db.from(table).delete().eq("application_id",appId));
  for (const user of users) await check(await db.from("notifications").delete().eq("user_id",user.id));
  await check(await db.from("applications").delete().eq("id",appId));
  await check(await db.from("vouchers").delete().eq("id",voucherId));
  await check(await db.from("payments").delete().eq("id",paymentId));
  for (const id of [appId,voucherId,paymentId,...users.map(u => u.id)]) await check(await db.from("audit_logs").delete().eq("target_id",id));
  for (const user of users) { await check(await db.from("audit_logs").delete().eq("actor_id",user.id)); await check(await db.auth.admin.deleteUser(user.id)); await check(await db.from("audit_logs").delete().eq("target_id",user.id)); }
  console.log("PASS: temporary hosted fixtures removed; no Paystack calls or employer matches.");
}

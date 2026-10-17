import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright-core";
const base = process.env.TEST_APP_URL || "http://localhost:3001";
const origin = new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").origin;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const options = { auth: { persistSession: false,autoRefreshToken: false } };
const db = createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY!,options);
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const users: { id: string; email: string; password: string }[] = [];
const notificationIds: string[] = [];
const browser = await chromium.launch({ channel: "msedge",headless: true,timeout: 300000 });
try {
  for (let i=0;i<2;i++) {
    const email = `cruiseapply-notification-${randomUUID()}@example.com`; const password = randomUUID()+randomUUID();
    const account = await db.auth.admin.createUser({ email,password,email_confirm: true });
    assert.ok(!account.error && account.data.user,account.error?.message);
    users.push({ id: account.data.user.id,email,password });
  }
  const owner = users[0]; const foreign = users[1];
  const rows = await db.from("notifications").insert([
    { user_id: owner.id,title: "Notification ownership test",body: "Disposable integration update.",href: "/dashboard/applications" },
    { user_id: owner.id,title: "Unsafe link test",body: "This update must not have an external link.",href: "https://example.com/unsafe" },
    { user_id: foreign.id,title: "Foreign notification",body: "Other account only.",href: "/dashboard" },
  ]).select("id,user_id,title");
  assert.ok(!rows.error && rows.data,rows.error?.message); notificationIds.push(...rows.data.map(row => row.id));
  const target = rows.data.find(row => row.title === "Notification ownership test")!;
  const otherId = rows.data.find(row => row.user_id === foreign.id)!.id;
  const direct = createClient(url,publicKey,options);
  assert.ok(!(await direct.auth.signInWithPassword({ email: owner.email,password: owner.password })).error);
  const foreignRead = await direct.from("notifications").select("id").eq("id",otherId);
  assert.ok(!foreignRead.error); assert.deepEqual(foreignRead.data,[]);
  await direct.from("notifications").update({ read_at: new Date().toISOString() }).eq("id",target.id);
  const untouched = await db.from("notifications").select("read_at").eq("id",target.id).single();
  assert.ok(!untouched.error); assert.equal(untouched.data?.read_at,null,"Authenticated REST must not bypass the server mutation boundary.");
  await direct.auth.signOut({ scope: "local" });
  const context = await browser.newContext({ viewport: { width: 390,height: 844 } }); context.setDefaultTimeout(300000);
  const headers = { Origin: origin };
  assert.equal((await context.request.post(`${base}/api/auth/login`,{ headers,data: { email: owner.email,password: owner.password },timeout: 300000 })).status(),200);
  const anonymous = await browser.newContext();
  assert.equal((await anonymous.request.post(`${base}/api/notifications/${target.id}/read`,{ headers,data: {},timeout: 300000 })).status(),401);
  await anonymous.close();
  assert.equal((await context.request.post(`${base}/api/notifications/${target.id}/read`,{ headers: { Origin: "https://foreign.example" },data: {},timeout: 300000 })).status(),403);
  assert.equal((await context.request.post(`${base}/api/notifications/${otherId}/read`,{ headers,data: {},timeout: 300000 })).status(),404);
  console.log("PASS: notification RLS, anonymous, origin and foreign-owner boundaries.");
  const page = await context.newPage();
  await page.goto(`${base}/dashboard/notifications?filter=unread`,{ waitUntil: "domcontentloaded",timeout: 300000 });
  await page.getByText("2 unread updates about your account and applications.",{ exact: true }).waitFor();
  assert.equal(await page.locator('a[href="https://example.com/unsafe"]').count(),0);
  await page.getByRole("button",{ name: "Mark as read",exact: true }).first().click();
  await page.getByText("1 unread updates about your account and applications.",{ exact: true }).waitFor();
  // Replay against a fixed target; whether its button was first or second, two calls converge.
  const replies = await Promise.all([1,2].map(() => context.request.post(`${base}/api/notifications/${target.id}/read`,{ headers,data: {},timeout: 300000 })));
  for (const result of replies) assert.equal(result.status(),200);
  assert.equal((await replies[0].json()).read_at,(await replies[1].json()).read_at);
  const originalRead = (await replies[0].json()).read_at;
  const replay = await context.request.post(`${base}/api/notifications/${target.id}/read`,{ headers,data: {},timeout: 300000 });
  assert.equal((await replay.json()).read_at,originalRead);
  await page.goto(`${base}/dashboard/notifications`,{ waitUntil: "domcontentloaded",timeout: 300000 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
  await page.screenshot({ path: "test-results/notifications-mobile.png",fullPage: true });
  const foreignUnchanged = await db.from("notifications").select("read_at").eq("id",otherId).single();
  assert.ok(!foreignUnchanged.error); assert.equal(foreignUnchanged.data?.read_at,null);
  console.log("PASS: mark-as-read UI, immutable retry timestamp, safe links, mobile layout.");
  const state = JSON.parse(await readFile("test-results/checkout-e2e-state.json","utf8"));
  const original = await browser.newContext(); original.setDefaultTimeout(300000);
  assert.equal((await original.request.post(`${base}/api/auth/login`,{ headers,data: { email: state.email,password: state.password },timeout: 300000 })).status(),200);
  const applicantPage = await original.newPage();
  await applicantPage.goto(`${base}/dashboard/applications?status=submitted`,{ waitUntil: "domcontentloaded",timeout: 300000 });
  await applicantPage.getByText("APP-2026-00000001",{ exact: true }).waitFor();
  await applicantPage.goto(`${base}/dashboard/applications?status=draft`,{ waitUntil: "domcontentloaded",timeout: 300000 });
  assert.equal(await applicantPage.getByText("APP-2026-00000001",{ exact: true }).count(),0);
  await applicantPage.goto(`${base}/dashboard/documents`,{ waitUntil: "domcontentloaded",timeout: 300000 });
  const downloads = applicantPage.getByRole("link",{ name: /^Download / });
  assert.equal(await downloads.count(),2);
  const download = await original.request.get(new URL((await downloads.first().getAttribute("href"))!,base).href,{ timeout: 300000 });
  assert.equal(download.status(),200); assert.match(download.headers()["content-disposition"],/attachment/);
  await applicantPage.goto(`${base}/dashboard`,{ waitUntil: "domcontentloaded",timeout: 300000 });
  await applicantPage.getByRole("link",{ name: "Unread updates",exact: true }).waitFor();
  await applicantPage.getByRole("link",{ name: "APP-2026-00000001",exact: true }).waitFor();
  console.log("PASS: original-owner status filtering, dashboard links and private document downloads; no original records mutated.");
} catch (error) { console.error("Phase 6 verification failed:",error); throw error; }
finally {
  await browser.close();
  if (notificationIds.length) { const result = await db.from("notifications").delete().in("id",notificationIds); assert.ok(!result.error,result.error?.message); }
  for (const user of users) {
    for (const column of ["actor_id","target_id"]) { const result = await db.from("audit_logs").delete().eq(column,user.id); assert.ok(!result.error,result.error?.message); }
    const result = await db.auth.admin.deleteUser(user.id); assert.ok(!result.error,result.error?.message);
    const audit = await db.from("audit_logs").delete().eq("target_id",user.id); assert.ok(!audit.error,audit.error?.message);
  }
  console.log("PASS: disposable notification fixtures removed.");
}

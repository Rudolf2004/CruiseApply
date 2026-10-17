import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { createClient } from "@supabase/supabase-js";

assert.ok(process.env.PAYSTACK_SECRET_KEY?.startsWith("sk_test_"), "Only Paystack TEST keys are permitted by this runner.");
const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const statePath = "test-results/checkout-e2e-state.json";
type State = { id: string; email: string; password: string; reference?: string; checkoutUrl?: string };
await mkdir("test-results", { recursive: true });
const mode = process.argv[2] ?? "prepare";
let state: State;
if (mode === "prepare") {
  try { await readFile(statePath); throw new Error("A checkout fixture already exists. Resume it rather than creating another purchase."); }
  catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  const product = await db.from("voucher_types").select("amount,currency,validity_days,active").eq("code", "application-access").single();
  assert.deepEqual(product.data, { amount: 15000, currency: "GHS", validity_days: 90, active: true });
  const email = `cruiseapply-e2e-${randomUUID()}@example.com`; const password = randomBytes(32).toString("hex");
  const account = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: "Paystack Test Checkout" } });
  assert.ok(!account.error && account.data.user, "Test applicant creation failed.");
  state = { id: account.data.user.id, email, password };
  await writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
} else {
  state = JSON.parse(await readFile(statePath, "utf8"));
  if (!state.checkoutUrl) {
    const saved = await db.from("payments").select("reference,checkout_url,amount,currency").eq("user_id", state.id);
    assert.ok(!saved.error && saved.data?.length === 1 && saved.data[0].checkout_url, "Expected one initialized checkout to resume.");
    assert.equal(saved.data[0].amount, 15000); assert.equal(saved.data[0].currency, "GHS");
    state.reference = saved.data[0].reference; state.checkoutUrl = saved.data[0].checkout_url;
    await writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
    console.log("PASS: resumed the existing initialized 15000 pesewa/GHS purchase; no new payment created.");
  }
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage(); page.setDefaultTimeout(60000);
try {
  const login = await context.request.post(`${base}/api/auth/login`, {
    headers: { Origin: new URL(base).origin }, data: { email: state.email, password: state.password }, timeout: 120000
  });
  assert.equal(login.status(), 200, "Test applicant login failed.");
  console.log("Applicant browser session authenticated.");
  if (mode === "verify" || mode === "status") {
    assert.ok(state.reference, "Missing initialized reference.");
    if (mode === "verify") {
      assert.equal(state.reference, "CA-ccca503b-90ab-4b19-b287-ff5ed3c51176", "Only the approved existing successful checkout may be verified in this investigation.");
      const response = await context.request.post(`${base}/api/payments/verify`, {
        headers: { Origin: new URL(base).origin }, data: { reference: state.reference }, timeout: 120000
      });
      assert.equal(response.status(), 200, "The app has not verified a successful provider payment; do not fulfill manually.");
      const result = await response.json(); assert.ok(result.voucherId);
      // Repeated verification must return the original voucher.
      const replay = await context.request.post(`${base}/api/payments/verify`, {
        headers: { Origin: new URL(base).origin }, data: { reference: state.reference }, timeout: 120000
      });
      assert.equal(replay.status(), 200); assert.equal((await replay.json()).voucherId, result.voucherId);
      const callback = await context.request.get(`${base}/api/payments/callback?reference=${state.reference}&trxref=${state.reference}`, { maxRedirects: 0, timeout: 120000 });
      assert.equal(callback.status(), 303);
      assert.equal(new URL(callback.headers().location).pathname, `/dashboard/vouchers/${result.voucherId}`);
      await page.goto(`${base}/dashboard/vouchers/${result.voucherId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
      assert.ok(await page.getByText(state.reference, { exact: true }).isVisible());
      assert.ok(await page.getByText(/Charge:.*150/).isVisible());
      const pin = page.locator("dt").filter({ hasText: "Voucher PIN" }).locator("..").locator("dd");
      assert.match((await pin.innerText()).trim(), /^\d{8}$/);
      await page.screenshot({ path: "test-results/voucher-receipt.png", fullPage: true, mask: [pin] });
      await page.goto(`${base}/dashboard/vouchers`, { waitUntil: "domcontentloaded", timeout: 120000 });
      assert.ok(await page.getByRole("link", { name: "View voucher & receipt" }).isVisible());
      await page.screenshot({ path: "test-results/voucher-history.png", fullPage: true });
      const foreignEmail = `cruiseapply-receipt-test-${randomUUID()}@example.com`;
      const foreignPassword = randomBytes(32).toString("hex");
      const foreign = await db.auth.admin.createUser({ email: foreignEmail, password: foreignPassword, email_confirm: true });
      assert.ok(!foreign.error && foreign.data.user, "Receipt isolation test setup failed.");
      const foreignId = foreign.data.user.id;
      const otherContext = await browser.newContext();
      try {
        const signedOut = await otherContext.request.get(`${base}/dashboard/vouchers/${result.voucherId}`, { maxRedirects: 0, timeout: 120000 });
        assert.ok([303,307].includes(signedOut.status()) || (await signedOut.text()).includes("NEXT_REDIRECT"), "Anonymous receipt must redirect.");
        assert.equal((await otherContext.request.post(`${base}/api/auth/login`, { headers: { Origin: new URL(base).origin }, data: { email: foreignEmail, password: foreignPassword } })).status(), 200);
        const forbidden = await otherContext.request.get(`${base}/dashboard/vouchers/${result.voucherId}`, { timeout: 120000 });
        const forbiddenBody = await forbidden.text();
        assert.ok(forbidden.status() === 404 || forbiddenBody.includes("NEXT_HTTP_ERROR_FALLBACK;404"), "Another applicant must not access the receipt.");
        assert.ok(!forbiddenBody.includes(state.reference!), "The foreign receipt response must not expose transaction details.");
        const wrongCallback = await otherContext.request.get(`${base}/api/payments/callback?reference=${state.reference}`, { maxRedirects: 0, timeout: 120000 });
        assert.equal(new URL(wrongCallback.headers().location).searchParams.get("verification"), "account");
        console.log("PASS: repeated status/callback verification returns the same voucher; anonymous and foreign receipt access denied; foreign callback shows account mismatch.");
      } finally {
        await otherContext.close();
        await db.from("audit_logs").delete().eq("actor_id", foreignId);
        await db.from("audit_logs").delete().eq("target_id", foreignId);
        assert.ok(!(await db.auth.admin.deleteUser(foreignId)).error, "Receipt-test account cleanup failed.");
        await db.from("audit_logs").delete().eq("target_id", foreignId);
      }
    }
    const payment = await db.from("payments").select("id,status,amount,currency,display_amount,display_currency").eq("reference", state.reference).single();
    assert.ok(!payment.error && payment.data);
    const vouchers = await db.from("vouchers").select("id", { count: "exact" }).eq("payment_id", payment.data.id);
    const notifications = await db.from("notifications").select("id", { count: "exact" }).eq("user_id", state.id).eq("title", "Voucher ready");
    assert.ok(!vouchers.error && !notifications.error);
    if (mode === "verify") { assert.equal(payment.data.status, "successful"); assert.equal(vouchers.count, 1); assert.equal(notifications.count, 1); }
    await page.goto(`${base}/dashboard/payments`, { waitUntil: "domcontentloaded", timeout: 120000 });
    assert.ok(await page.getByText(state.reference, { exact: true }).isVisible());
    assert.ok(await page.getByText(/Charge:.*150/).isVisible());
    await page.screenshot({ path: "test-results/payment-history.png", fullPage: true });
    console.log("Payment state:", { reference: state.reference, status: payment.data.status, amount: payment.data.amount, currency: payment.data.currency, vouchers: vouchers.count, voucherNotifications: notifications.count });
    console.log("PASS: applicant payment history shows the purchase and GHS 150 charge.");
  } else {
  if (mode === "prepare") {
    await page.goto(`${base}/buy-voucher`, { waitUntil: "networkidle", timeout: 120000 });
    assert.ok(await page.getByText("CruiseApply Application Access", { exact: true }).isVisible());
    await page.getByLabel("Country of residence").selectOption("GH");
    const quoted = page.waitForResponse(response => response.url().endsWith("/api/payments/quote") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Review price", exact: true }).click();
    const quoteResponse = await quoted; assert.equal(quoteResponse.status(), 200);
    const { quote } = await quoteResponse.json();
    assert.equal(quote.charge_amount, 15000); assert.equal(quote.charge_currency, "GHS");
    assert.equal(quote.display_amount, 15000); assert.equal(quote.display_currency, "GHS");
    assert.ok(await page.getByText(/Charged by Paystack:.*150/).isVisible());
    await page.screenshot({ path: "test-results/checkout-price.png", fullPage: true });
    const initialized = page.waitForResponse(response => response.url().endsWith("/api/payments/initialize") && response.request().method() === "POST");
    await page.getByRole("button", { name: /Pay .*150.* with Paystack/ }).click();
    const response = await initialized;
    assert.equal(response.status(), 200, `Initialization failed with HTTP ${response.status()}`);
    // Read the persisted initialization result: navigation can discard the browser response body.
    const persisted = await db.from("payments").select("reference,checkout_url").eq("user_id", state.id).single();
    assert.ok(!persisted.error && persisted.data?.checkout_url, "Initialized checkout was not persisted.");
    state.reference = persisted.data.reference; state.checkoutUrl = persisted.data.checkout_url;
    await writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
    const payment = await db.from("payments").select("amount,currency,status").eq("reference", state.reference).single();
    assert.equal(payment.data?.amount, 15000); assert.equal(payment.data?.currency, "GHS");
    console.log("PASS: visible product and GHS 150 price; server quote and initialized payment are exactly 15000 pesewas/GHS.");
  }
  assert.ok(state.checkoutUrl && state.reference, "Checkout is not initialized.");
  await page.goto(state.checkoutUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "test-results/paystack-checkout.png", fullPage: true });
  console.log("Checkout reference:", state.reference);
  console.log("Hosted checkout visible text:", (await page.locator("body").innerText()).slice(0, 10000));
  console.log("Hosted checkout input metadata:", await page.locator("input").evaluateAll(inputs => inputs.map(input => ({ name: input.name, placeholder: input.placeholder, type: input.type }))));
  console.log("Frames:", page.frames().map(frame => frame.url()));
  }
} finally { await browser.close(); }

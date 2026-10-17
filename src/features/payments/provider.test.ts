import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { assertVerifiedPayment, paystack, validWebhookSignature } from "./provider";
const expected = { reference: "CA-test", amount: 12345, currency: "GHS", customer_email: "owner@example.com" };
const verified = { ...expected, email: expected.customer_email, status: "success", domain: "test", id: "18446744073709551615" };
describe("Paystack boundary", () => {
  beforeEach(() => vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_fixture"));
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  it("signs the exact raw body and rejects changes, missing and malformed signatures", () => {
    const body = Buffer.from('{"event":"charge.success"}');
    const signature = createHmac("sha512", "sk_test_fixture").update(body).digest("hex");
    expect(validWebhookSignature(body, signature)).toBe(true);
    expect(validWebhookSignature(Buffer.concat([body, Buffer.from(" ")]), signature)).toBe(false);
    expect(validWebhookSignature(body, null)).toBe(false);
    expect(validWebhookSignature(body, "not-hex")).toBe(false);
  });
  it.each([
    { status: "pending" }, { status: "failed" }, { amount: 12344 }, { currency: "USD" },
    { reference: "other" }, { email: "another@example.com" }, { domain: "live" }
  ])("rejects a verification mismatch: %j", mismatch => {
    expect(() => assertVerifiedPayment({ ...verified, ...mismatch }, expected)).toThrow();
  });
  it("accepts matching confirmed payments", () => expect(() => assertVerifiedPayment(verified, expected)).not.toThrow());
  it("sends integer minor units, a callback and no recurring-charge parameters", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ status: true, data: { reference: "CA-test", authorization_url: "https://checkout.paystack.com/test" } }));
    vi.stubGlobal("fetch", fetcher);
    await paystack.initialize({ reference: "CA-test", amount: 12345, currency: "GHS", email: "owner@example.com", callbackUrl: "https://example.com/api/payments/callback" });
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body).toEqual({ reference: "CA-test", amount: "12345", currency: "GHS", email: "owner@example.com", callback_url: "https://example.com/api/payments/callback" });
  });
  it("rejects unexpected checkout destinations", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ status: true, data: { reference: "CA-test", authorization_url: "https://checkout.paystack.com.attacker.example/test" } })));
    await expect(paystack.initialize({ reference: "CA-test", amount: 100, currency: "GHS", email: "owner@example.com", callbackUrl: "https://example.com" })).rejects.toThrow();
  });
  it("never sends a localized display currency to this merchant's checkout", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(paystack.initialize({ reference: "CA-test", amount: 12345, currency: "NGN", email: "owner@example.com", callbackUrl: "https://example.com" })).rejects.toThrow("GHS");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("preserves unsigned 64-bit transaction IDs without retaining authorization data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"status":true,"data":{"id":18446744073709551615,"reference":"CA-test","amount":12345,"currency":"GHS","status":"success","domain":"test","customer":{"email":"owner@example.com"},"authorization":{"authorization_code":"must-not-be-stored"}}}')));
    const result = await paystack.verify("CA-test");
    expect(result.id).toBe("18446744073709551615");
    expect(result).not.toHaveProperty("authorization");
  });
  it("does not accept a provider error as verification", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ status: false, message: "error" })));
    await expect(paystack.verify("CA-test")).rejects.toThrow();
  });
});

import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/features/payments/service", () => ({ verifyAndFulfill: vi.fn() }));
import { verifyAndFulfill } from "@/features/payments/service";
import { POST } from "./route";
const body = JSON.stringify({ event: "charge.success", data: { reference: "CA-12345678-1234-1234-1234-123456789abc" } });
function event(raw = body, signed = true) {
  return new Request("http://localhost/api/payments/webhook", { method: "POST", body: raw, headers: signed ? { "x-paystack-signature": createHmac("sha512", "sk_test_fixture").update(raw).digest("hex") } : {} });
}
describe("Paystack webhook route", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_fixture"); });
  afterEach(() => vi.unstubAllEnvs());
  it("rejects unsigned requests before processing", async () => {
    expect((await POST(event(body, false))).status).toBe(401);
    expect(verifyAndFulfill).not.toHaveBeenCalled();
  });
  it("acknowledges successful duplicate deliveries through the common fulfillment gate", async () => {
    vi.mocked(verifyAndFulfill).mockResolvedValue("same-voucher");
    const responses = await Promise.all([POST(event()), POST(event())]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(verifyAndFulfill).toHaveBeenCalledTimes(2);
  });
  it("returns a retryable failure if provider verification or fulfillment fails", async () => {
    vi.mocked(verifyAndFulfill).mockRejectedValue(new Error("Transient failure"));
    expect((await POST(event())).status).toBe(500);
  });
  it("ignores other event types and rejects malformed signed payloads", async () => {
    expect((await POST(event(JSON.stringify({ event: "subscription.create", data: {} })))).status).toBe(200);
    expect((await POST(event("{"))).status).toBe(400);
    expect(verifyAndFulfill).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ serviceDatabase: vi.fn() }));
vi.mock("./provider", async importOriginal => ({ ...await importOriginal<typeof import("./provider")>(), paystack: { verify: vi.fn(), initialize: vi.fn() } }));
vi.mock("@/lib/voucher-credentials", () => ({ createVoucherCredentials: async () => ({ pinHash: "hash", pinEncrypted: "encrypted" }) }));
import { serviceDatabase } from "@/lib/supabase/server";
import { paystack } from "./provider";
import { initializePurchase, verifyAndFulfill } from "./service";
describe("fulfillment verification gate", () => {
  const payment = { reference: "CA-test", amount: 12345, currency: "GHS", customer_email: "owner@example.com", status: "pending", user_id: "owner" };
  const rpc = vi.fn();
  const eq = vi.fn();
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_fixture");
    const query = { eq, maybeSingle: async () => ({ data: payment, error: null }) };
    eq.mockReturnValue(query);
    vi.mocked(serviceDatabase).mockReturnValue({ from: () => ({ select: () => query }), rpc } as unknown as ReturnType<typeof serviceDatabase>);
    rpc.mockResolvedValue({ data: "voucher-id", error: null });
    vi.mocked(paystack.verify).mockResolvedValue({ reference: "CA-test", amount: 12345, currency: "GHS", email: payment.customer_email, status: "success", domain: "test", id: "123" });
  });
  it("restricts callback/recheck lookup to the signed-in owner", async () => {
    expect(await verifyAndFulfill("CA-test", "owner")).toBe("voucher-id");
    expect(eq).toHaveBeenCalledWith("user_id", "owner");
    expect(rpc).toHaveBeenCalledWith("fulfill_verified_payment", expect.objectContaining({ p_reference: "CA-test", p_amount: 12345, p_provider_id: "123" }));
  });
  it("fulfills a verified guest payment without persisting retrievable PIN credentials", async () => {
    const query = { eq, maybeSingle: async () => ({ data: {...payment,user_id:null,applicant_id:"a752cd69-2810-4ae1-92a5-a49e067d3698"},error:null }) }; eq.mockReturnValue(query);
    vi.mocked(serviceDatabase).mockReturnValue({from:()=>({select:()=>query}),rpc} as unknown as ReturnType<typeof serviceDatabase>);
    await verifyAndFulfill("CA-test");
    expect(rpc).toHaveBeenCalledWith("fulfill_verified_payment",expect.objectContaining({p_pin_hash:null,p_pin_encrypted:null,p_amount:12345,p_currency:"GHS"}));
  });
  it("never invokes fulfillment on mismatched or failed verification", async () => {
    vi.mocked(paystack.verify).mockResolvedValue({ reference: "CA-test", amount: 1, currency: "GHS", email: payment.customer_email, status: "success", domain: "test", id: "123" });
    await expect(verifyAndFulfill("CA-test")).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
    vi.mocked(paystack.verify).mockRejectedValue(new Error("Provider timeout"));
    await expect(verifyAndFulfill("CA-test")).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("does not fulfill an abandoned checkout even when all payment identity fields match", async () => {
    vi.mocked(paystack.verify).mockResolvedValue({ reference: "CA-test", amount: 12345, currency: "GHS", email: payment.customer_email, status: "abandoned", domain: "test", id: "123" });
    await expect(verifyAndFulfill("CA-test", "owner")).rejects.toThrow("verification did not match");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects an absent owner-scoped payment before calling Paystack or fulfillment", async () => {
    const scoped = { eq: vi.fn(), maybeSingle: async () => ({ data: null, error: null }) };
    scoped.eq.mockReturnValue(scoped);
    vi.mocked(serviceDatabase).mockReturnValue({ from: () => ({ select: () => scoped }), rpc } as unknown as ReturnType<typeof serviceDatabase>);
    await expect(verifyAndFulfill("CA-test", "different-owner")).rejects.toMatchObject({ status: 404 });
    expect(scoped.eq).toHaveBeenCalledWith("user_id", "different-owner");
    expect(paystack.verify).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("surfaces database failure so the webhook can be retried", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "unavailable" } });
    await expect(verifyAndFulfill("CA-test")).rejects.toThrow("could not be fulfilled");
  });
  it("charges the GHS snapshot even when the displayed estimate is NGN", async () => {
    const finalEq = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(serviceDatabase).mockReturnValue({ rpc, from: () => ({ update: () => ({ eq: () => ({ eq: finalEq }) }) }) } as unknown as ReturnType<typeof serviceDatabase>);
    rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: {
      reference: "CA-quote", charge_amount: 7654, charge_currency: "GHS", display_amount: 999999,
      display_currency: "NGN", customer_email: "database@example.com", status: "initialized"
    }, error: null });
    vi.mocked(paystack.initialize).mockResolvedValue("https://checkout.paystack.com/fixture");
    await initializePurchase({ id: "owner", email: "browser-not-authoritative@example.com" }, "quote-id");
    expect(paystack.initialize).toHaveBeenCalledWith(expect.objectContaining({ amount: 7654, currency: "GHS", email: "database@example.com", reference: "CA-quote" }));
    expect(rpc).toHaveBeenCalledWith("create_payment_from_quote", expect.objectContaining({ p_user_id: "owner", p_quote_id: "quote-id" }));
  });
});

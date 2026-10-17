import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ serviceDatabase: vi.fn() }));
vi.mock("@/lib/voucher-credentials", () => ({ verifyVoucherPin: vi.fn() }));
vi.mock("@/features/payments/service", () => ({ paymentLimit: vi.fn() }));
import { serviceDatabase } from "@/lib/supabase/server";
import { verifyVoucherPin } from "@/lib/voucher-credentials";
import { paymentLimit } from "@/features/payments/service";
import { redeemVoucher } from "./service";
describe("voucher redemption boundary", () => {
  const input = { serial: "CRV-2026-00000003", pin: "12345678", jobId: "5b0823b0-a0d1-4323-bf46-9c83e6f64dd8" };
  const rpc = vi.fn(); const eq = vi.fn(); const lookup = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks(); const query = { eq, maybeSingle: lookup }; eq.mockReturnValue(query);
    lookup.mockResolvedValue({ data: { id: "voucher-id", pin_hash: "private-hash" }, error: null });
    rpc.mockImplementation(async name=>name==="get_voucher_login_material"?{data:[{voucher_id:"voucher-id",pin_hash:"private-hash"}],error:null}:{data:"application-id",error:null});
    vi.mocked(serviceDatabase).mockReturnValue({ from: () => ({ select: () => query }), rpc } as unknown as ReturnType<typeof serviceDatabase>);
    vi.mocked(verifyVoucherPin).mockResolvedValue(true);
  });
  it("scopes lookup to the owner, throttles, verifies PIN and passes only the verified hash to the atomic operation", async () => {
    expect(await redeemVoucher("owner",input)).toBe("application-id");
    expect(paymentLimit).toHaveBeenCalledWith("redeem:owner",8,600);
    expect(eq).toHaveBeenCalledWith("user_id","owner");
    expect(verifyVoucherPin).toHaveBeenCalledWith(input.pin,"private-hash");
    expect(rpc).toHaveBeenCalledWith("redeem_verified_voucher", { p_user_id: "owner", p_serial: input.serial, p_pin_hash: "private-hash", p_job_id: input.jobId });
  });
  it("rejects absent ownership or an incorrect PIN without mutation", async () => {
    vi.mocked(verifyVoucherPin).mockResolvedValue(false);
    await expect(redeemVoucher("owner",input)).rejects.toMatchObject({ status: 400 });
    lookup.mockResolvedValue({ data: null,error: null });
    await expect(redeemVoucher("foreign",input)).rejects.toMatchObject({ status: 400 });
    expect(rpc).not.toHaveBeenCalledWith("redeem_verified_voucher",expect.anything());
  });
  it("recovers a concurrent committed redemption only by owner, voucher AND selected job", async () => {
    rpc.mockImplementation(async name=>name==="get_voucher_login_material"?{data:[{voucher_id:"voucher-id",pin_hash:"hash"}],error:null}:{error:{message:"Voucher unavailable"}});
    lookup.mockResolvedValueOnce({ data: { id: "voucher-id",pin_hash: "hash" } }).mockResolvedValueOnce({ data: { id: "existing-id" } });
    expect(await redeemVoucher("owner",input)).toBe("existing-id");
    expect(eq).toHaveBeenCalledWith("voucher_id","voucher-id");
    expect(eq).toHaveBeenCalledWith("job_id",input.jobId);
  });
  it("does not recover a different job or create an application directly", async () => {
    rpc.mockImplementation(async name=>name==="get_voucher_login_material"?{data:[{voucher_id:"voucher-id",pin_hash:"hash"}],error:null}:{error:{message:"Voucher unavailable"}});
    lookup.mockResolvedValueOnce({ data: { id: "voucher-id",pin_hash: "hash" } }).mockResolvedValueOnce({ data: null });
    await expect(redeemVoucher("owner",input)).rejects.toMatchObject({ status: 409 });
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it("uses the rotated hash rather than the historical voucher PIN",async()=>{
    rpc.mockImplementation(async name=>name==="get_voucher_login_material"?{data:[{voucher_id:"voucher-id",pin_hash:"rotated-hash"}],error:null}:{data:"application-id",error:null});
    await redeemVoucher("owner",input);expect(verifyVoucherPin).toHaveBeenCalledWith(input.pin,"rotated-hash");
    expect(rpc).toHaveBeenCalledWith("redeem_verified_voucher",expect.objectContaining({p_pin_hash:"rotated-hash"}));
  });
  it("does not bypass an exhausted request limit", async () => {
    vi.mocked(paymentLimit).mockRejectedValueOnce(new Error("limited"));
    await expect(redeemVoucher("owner",input)).rejects.toThrow("limited");
    expect(serviceDatabase).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/http", async original => ({ ...await original<typeof import("@/lib/http")>(), apiUser: vi.fn() }));
vi.mock("@/features/payments/service", () => ({ paymentLimit: vi.fn(), verifyAndFulfill: vi.fn() }));
import { ApiError, apiUser } from "@/lib/http";
import { paymentLimit, verifyAndFulfill } from "@/features/payments/service";
import { GET } from "./route";
const reference = "CA-ccca503b-90ab-4b19-b287-ff5ed3c51176";
const request = () => new Request(`http://localhost/api/payments/callback?reference=${reference}&trxref=${reference}`);
describe("payment callback ownership and reference", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiUser).mockResolvedValue({ user: { id: "owner" } } as Awaited<ReturnType<typeof apiUser>>);
    vi.mocked(paymentLimit).mockResolvedValue(undefined);
    vi.mocked(verifyAndFulfill).mockResolvedValue("voucher-id");
  });
  it("verifies the supplied reference for the authenticated owner", async () => {
    const response = await GET(request());
    expect(verifyAndFulfill).toHaveBeenCalledWith(reference, "owner");
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/dashboard/vouchers/voucher-id");
  });
  it.each([401, 403])("distinguishes session failure %s from payment pending", async status => {
    vi.mocked(apiUser).mockRejectedValue(new ApiError(status, "Unavailable session"));
    const response = await GET(request());
    expect(new URL(response.headers.get("location")!).searchParams.get("verification")).toBe("account");
    expect(verifyAndFulfill).not.toHaveBeenCalled();
  });
  it("distinguishes an owner-scoped missing payment without exposing another owner", async () => {
    vi.mocked(verifyAndFulfill).mockRejectedValue(new ApiError(404, "Payment not found."));
    const response = await GET(request());
    expect(new URL(response.headers.get("location")!).searchParams.get("verification")).toBe("account");
  });
  it("keeps provider/database failures retryable without claiming success", async () => {
    vi.mocked(verifyAndFulfill).mockRejectedValue(new Error("Verification failed"));
    const response = await GET(request());
    expect(new URL(response.headers.get("location")!).searchParams.get("verification")).toBe("pending");
  });
});

import { describe, expect, it } from "vitest";
import { credentialsSchema, safeNext, voucherSchema } from "./validation";
describe("security boundary validation", () => {
  it("rejects weak passwords and malformed email", () => {
    expect(credentialsSchema.safeParse({ email: "invalid", password: "short" }).success).toBe(false);
    expect(credentialsSchema.safeParse({ email: "applicant@example.com", password: "a-long-password" }).success).toBe(true);
  });
  it("restricts redirects to local paths", () => {
    for (const value of ["https://evil.test", "//evil.test", "/\\evil.test", "/\t/evil.test", null]) expect(safeNext(value)).toBe("/dashboard");
    expect(safeNext("/application")).toBe("/application");
  });
  it("rejects malformed voucher credentials and job identifiers", () => {
    expect(voucherSchema.safeParse({ serial: "CRV-2026-00000001", pin: "12345678", jobId: "00000000-0000-4000-8000-000000000001" }).success).toBe(true);
    expect(voucherSchema.safeParse({ serial: "CRV-2026-1", pin: "1", jobId: "other" }).success).toBe(false);
  });
});

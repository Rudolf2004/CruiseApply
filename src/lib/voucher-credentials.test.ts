import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createVoucherCredentials, decryptVoucherPin, verifyVoucherPin } from "./voucher-credentials";

describe("voucher credentials", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("encrypts recoverable eight-digit PINs and verifies salted hashes", async () => {
    vi.stubEnv("VOUCHER_ENCRYPTION_KEY", "ab".repeat(32));
    const credentials = await createVoucherCredentials();
    const pin = decryptVoucherPin(credentials.pinEncrypted);
    expect(pin).toMatch(/^\d{8}$/);
    expect(await verifyVoucherPin(pin, credentials.pinHash)).toBe(true);
    const wrong = `${(Number(pin[0]) + 1) % 10}${pin.slice(1)}`;
    expect(await verifyVoucherPin(wrong, credentials.pinHash)).toBe(false);
    expect(await verifyVoucherPin(pin, "malformed")).toBe(false);
    expect(await verifyVoucherPin("1", credentials.pinHash)).toBe(false);
  });
  it("rejects ciphertext tampering and the wrong key", async () => {
    vi.stubEnv("VOUCHER_ENCRYPTION_KEY", "ab".repeat(32));
    const { pinEncrypted } = await createVoucherCredentials();
    const last = pinEncrypted.at(-1) === "0" ? "1" : "0";
    expect(() => decryptVoucherPin(pinEncrypted.slice(0, -1) + last)).toThrow();
    vi.stubEnv("VOUCHER_ENCRYPTION_KEY", "cd".repeat(32));
    expect(() => decryptVoucherPin(pinEncrypted)).toThrow();
  });
  it("fails closed with a missing encryption key", async () => {
    vi.stubEnv("VOUCHER_ENCRYPTION_KEY", "");
    await expect(createVoucherCredentials()).rejects.toThrow("not configured");
  });
});

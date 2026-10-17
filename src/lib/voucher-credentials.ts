import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const derive = promisify(scrypt);
function encryptionKey() {
  const key = process.env.VOUCHER_ENCRYPTION_KEY;
  if (!key || !/^[a-f\d]{64}$/i.test(key)) throw new Error("Voucher encryption is not configured.");
  return Buffer.from(key, "hex");
}
export async function createApplicantPin() {
  const pin = randomInt(0, 100000000).toString().padStart(8, "0");
  const salt = randomBytes(16).toString("hex");
  const hash = await derive(pin, salt, 32) as Buffer;
  return { pin, pinHash: `s1:${salt}:${hash.toString("hex")}` };
}
export async function createVoucherCredentials() {
  const { pin, pinHash } = await createApplicantPin();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(pin, "utf8"), cipher.final()]);
  return {
    pinHash,
    pinEncrypted: `v1:${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${encrypted.toString("hex")}`
  };
}
export async function verifyVoucherPin(pin: string, stored: string) {
  if (!/^\d{8}$/.test(pin)) return false;
  const match = /^s1:([a-f\d]{32}):([a-f\d]{64})$/.exec(stored);
  if (!match) return false;
  const actual = await derive(pin, match[1], 32) as Buffer;
  return timingSafeEqual(actual, Buffer.from(match[2], "hex"));
}
// Call only after verifying voucher ownership on the server.
export function decryptVoucherPin(stored: string) {
  const match = /^v1:([a-f\d]{24}):([a-f\d]{32}):([a-f\d]{16})$/.exec(stored);
  if (!match) throw new Error("Invalid voucher credential format.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(match[1], "hex"));
  decipher.setAuthTag(Buffer.from(match[2], "hex"));
  return Buffer.concat([decipher.update(Buffer.from(match[3], "hex")), decipher.final()]).toString("utf8");
}

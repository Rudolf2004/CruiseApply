import "server-only";
import {assertPaymentMode} from "./mode";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export type PaymentRequest = { reference: string; amount: number; currency: string; email: string; callbackUrl: string };
export type VerifiedTransaction = { reference: string; amount: number; currency: string; email: string; id: string; status: string; domain: string };
export interface PaymentProvider {
  initialize(input: PaymentRequest): Promise<string>;
  verify(reference: string): Promise<VerifiedTransaction>;
}
export function paystackSecret() {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key || !/^sk_(test|live)_/.test(key)) throw new Error("Payment provider is not configured.");
  assertPaymentMode(key);
  return key;
}
export function validWebhookSignature(raw: Buffer, signature: string | null) {
  if (!signature || !/^[a-f\d]{128}$/i.test(signature)) return false;
  const expected = createHmac("sha512", paystackSecret()).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
async function call(path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`https://api.paystack.co${path}`, {
    method: body ? "POST" : "GET", cache: "no-store", signal: AbortSignal.timeout(12000),
    headers: { Authorization: `Bearer ${paystackSecret()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.ok) throw new Error("Payment provider request failed.");
  // Preserve the unsigned 64-bit transaction ID before JSON number conversion.
  const raw = await response.text();
  const parsed = JSON.parse(raw.replace(/("id"\s*:\s*)(\d+)(?=\s*[,}])/g, '$1"$2"'));
  return z.object({ status: z.literal(true), data: z.unknown() }).parse(parsed).data;
}
export const paystack: PaymentProvider = {
  async initialize(input) {
    if (input.currency !== "GHS") throw new Error("This merchant is configured for GHS charges only.");
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error("Invalid payment amount.");
    const data = z.object({ reference: z.string(), authorization_url: z.url() }).parse(await call("/transaction/initialize", {
      reference: input.reference, amount: String(input.amount), currency: input.currency,
      email: input.email, callback_url: input.callbackUrl
    }));
    const url = new URL(data.authorization_url);
    if (data.reference !== input.reference || url.protocol !== "https:" || url.hostname !== "checkout.paystack.com" || url.username || url.password || url.port) throw new Error("Invalid checkout response.");
    return url.href;
  },
  async verify(reference) {
    const data = z.object({ id: z.string().regex(/^\d+$/), reference: z.string(), amount: z.number().int().positive().safe(), currency: z.string(), status: z.string(), domain: z.enum(["test", "live"]), customer: z.object({ email: z.email() }) }).parse(await call(`/transaction/verify/${encodeURIComponent(reference)}`));
    return { ...data, email: data.customer.email };
  }
};
export function assertVerifiedPayment(transaction: VerifiedTransaction, expected: { reference: string; amount: number; currency: string; customer_email: string }) {
  if (transaction.status !== "success" || transaction.reference !== expected.reference || transaction.amount !== expected.amount || transaction.currency !== expected.currency || transaction.email.toLowerCase() !== expected.customer_email.toLowerCase() || transaction.domain !== (paystackSecret().startsWith("sk_test_") ? "test" : "live")) throw new Error("Payment verification did not match the purchase.");
}

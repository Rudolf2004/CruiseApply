import "server-only";
import { randomUUID } from "node:crypto";
import { appUrl } from "@/lib/config";
import { ApiError } from "@/lib/http";
import { serviceDatabase } from "@/lib/supabase/server";
import { createVoucherCredentials } from "@/lib/voucher-credentials";
import { assertVerifiedPayment, paystack } from "./provider";

export async function paymentLimit(key: string, limit = 10, seconds = 600) {
  const { data, error } = await serviceDatabase().rpc("consume_request_limit", { p_key: key, p_limit: limit, p_seconds: seconds });
  if (error) throw new Error("Request limit unavailable.");
  if (!data) throw new ApiError(429, "Please wait before trying again.");
}
export async function initializePurchase(user: { id: string; email?: string }, quoteId: string, jobId?: string) {
  if (!user.email) throw new ApiError(400, "An email address is required.");
  await paymentLimit(`purchase:${user.id}`);
  const db = serviceDatabase();
  // The locked quote operation snapshots pricing and derives email from auth.users.
  // Reusing a quote returns the same payment/reference, never a new purchase.
  const saved = await db.rpc("create_payment_from_quote", { p_user_id: user.id, p_quote_id: quoteId, p_reference: `CA-${randomUUID()}`, p_job_id: jobId ?? null });
  if (saved.error || !saved.data) throw new ApiError(409, "This quote expired or is unavailable. Request an updated price.");
  const payment = saved.data;
  if (payment.charge_currency !== "GHS") throw new Error("Merchant charge currency is not enabled.");
  if (["successful", "refunded"].includes(payment.status)) throw new ApiError(409, "This purchase is already complete. View your payment history.");
  const reference = payment.reference;
  if (payment.checkout_url) return { authorizationUrl: payment.checkout_url as string, reference };
  const authorizationUrl = await paystack.initialize({ reference, amount: payment.charge_amount, currency: payment.charge_currency, email: payment.customer_email, callbackUrl: new URL("/api/payments/callback", appUrl).href });
  const updated = await db.from("payments").update({ status: "pending", checkout_url: authorizationUrl }).eq("reference", reference).eq("status", "initialized");
  if (updated.error) throw new Error("Could not update the purchase.");
  return { authorizationUrl, reference };
}
export async function verifyAndFulfill(reference: string, ownerId?: string) {
  const db = serviceDatabase();
  let query = db.from("payments").select("reference,amount,currency,customer_email,status,user_id,applicant_id").eq("reference", reference);
  if (ownerId) query = query.eq("user_id", ownerId);
  const { data: payment, error } = await query.maybeSingle();
  if (error) throw new Error("Payment lookup failed.");
  if (!payment) throw new ApiError(404, "Payment not found.");
  if (payment.status === "refunded") throw new ApiError(409, "This payment was refunded.");
  const transaction = await paystack.verify(reference);
  assertVerifiedPayment(transaction, payment);
  const guest = payment.user_id === null && typeof payment.applicant_id === "string";
  const credentials = guest ? null : await createVoucherCredentials();
  const result = await db.rpc("fulfill_verified_payment", {
    p_reference: reference, p_amount: transaction.amount, p_currency: transaction.currency,
    p_email: transaction.email, p_provider_id: transaction.id,
    p_pin_hash: credentials?.pinHash ?? null, p_pin_encrypted: credentials?.pinEncrypted ?? null
  });
  if (result.error || !result.data) throw new Error("Verified payment could not be fulfilled. Please retry.");
  return result.data as string;
}

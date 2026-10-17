import "server-only";
import { ApiError } from "@/lib/http";
import { serviceDatabase } from "@/lib/supabase/server";
import { verifyVoucherPin } from "@/lib/voucher-credentials";
import { voucherSchema } from "@/lib/validation";
import { paymentLimit } from "@/features/payments/service";

export async function redeemVoucher(ownerId: string, input: unknown) {
  const { serial, pin, jobId } = voucherSchema.parse(input);
  await paymentLimit(`redeem:${ownerId}`, 8, 600);
  const db = serviceDatabase();
  const { data: voucher, error } = await db.from("vouchers").select("id,pin_hash")
    .eq("serial", serial).eq("user_id", ownerId).maybeSingle();
  if (error) throw new Error("Voucher lookup unavailable.");
  if (!voucher) throw new ApiError(400, "The voucher details are invalid or unavailable for this account.");
  const material = await db.rpc("get_voucher_login_material", {p_serial:serial});
  const current = Array.isArray(material.data) ? material.data[0] : null;
  if (material.error) throw new Error("Voucher verification unavailable.");
  if (!current || current.voucher_id !== voucher.id || !await verifyVoucherPin(pin, current.pin_hash)) throw new ApiError(400, "The voucher details are invalid or unavailable for this account.");
  const result = await db.rpc("redeem_verified_voucher", {
    p_user_id: ownerId, p_serial: serial, p_pin_hash: current.pin_hash, p_job_id: jobId,
  });
  if (!result.error && result.data) return result.data as string;
  if(result.error?.message.includes("Invalid voucher")) throw new ApiError(400,"The voucher credentials changed. Please sign in again.");
  // A lost response or concurrent redemption may already have created the draft.
  // Only recover the same owner's application for exactly this voucher and job.
  const existing = await db.from("applications").select("id").eq("user_id", ownerId)
    .eq("voucher_id", voucher.id).eq("job_id", jobId).maybeSingle();
  if (existing.error) throw new Error("Application lookup unavailable.");
  if (existing.data) return existing.data.id as string;
  throw new ApiError(409, "This voucher cannot start that application. Check its expiry, linked vacancy and whether the vacancy is still open.");
}

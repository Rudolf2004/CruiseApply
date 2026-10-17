import "server-only";
import {assertPaymentMode} from "@/features/payments/mode";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import { serviceDatabase } from "@/lib/supabase/server";
import { createApplicantPin } from "@/lib/voucher-credentials";
import { ApplicantAuthError, assertApplicantRollout, tokenDigest, validToken } from "@/features/applicant-auth/policy";
import { paystack, paystackSecret } from "@/features/payments/provider";
import { paymentLimit, verifyAndFulfill } from "@/features/payments/service";
import { quoteSchema } from "@/features/payments/pricing";
export const CHECKOUT_COOKIE="__Host-cruiseapply_checkout";
export function guestEnabled(){assertApplicantRollout();assertPaymentMode(paystackSecret());}
async function guestRpc(raw:string|null,name:string,args:Record<string,unknown>={}){
  guestEnabled();if(!raw||!validToken(raw))throw new ApplicantAuthError(401);
  const result=await serviceDatabase().rpc(name,{...args,p_capability_hash:tokenDigest(raw)});
  if(result.error)throw new ApiError(result.error.code==="28000"?401:result.error.code==="P0001"?409:503,"This checkout is unavailable or has already been completed. Please check its status.");
  return result.data;
}
export async function guestStatus(raw:string|null){return z.object({checkout_id:z.uuid(),payment:z.object({reference:z.string(),status:z.string(),charge_amount:z.number().int(),charge_currency:z.literal("GHS"),product_name:z.string().nullable(),paid_at:z.string().nullable(),claim_available:z.boolean().nullable()}).nullable()}).parse(await guestRpc(raw,"get_guest_checkout"));}
export async function guestQuote(input:unknown,clientKey:string,previous:string|null){
  guestEnabled();const values=z.object({voucherTypeId:z.uuid(),countryCode:z.string().regex(/^[A-Z]{2}$/),email:z.email().max(254),name:z.string().trim().min(1).max(200)}).strict().parse(input);
  await paymentLimit(`guest-quote:${clientKey}`,20,600);
  if(previous){let pending=false;try{pending=!!(await guestStatus(previous)).payment;}catch(error){if(!(error instanceof ApiError&&error.status===401)&&!(error instanceof ApplicantAuthError&&error.status===401))throw error;}if(pending)throw new ApiError(409,"An existing checkout is linked to this browser. Open its payment status before starting another purchase.");}
  const raw=randomBytes(32).toString("base64url"),db=serviceDatabase();
  const created=await db.rpc("begin_guest_checkout",{p_capability_hash:tokenDigest(raw),p_email:values.email,p_name:values.name,p_country_code:values.countryCode});
  if(created.error)throw new ApiError(503,"Checkout could not be prepared. Please retry.");
  const quote=quoteSchema.parse(await guestRpc(raw,"create_guest_quote",{p_type_id:values.voucherTypeId}));
  return {raw,quote};
}
export async function guestInitialize(raw:string|null,input:unknown){
  guestEnabled();const values=z.object({quoteId:z.uuid(),jobId:z.uuid().optional()}).strict().parse(input);
  if(!raw||!validToken(raw))throw new ApplicantAuthError(401);
  await paymentLimit(`guest-initialize:${tokenDigest(raw)}`,10,600);
  const payment=z.object({reference:z.string(),status:z.string(),charge_amount:z.number().int().positive().safe(),charge_currency:z.literal("GHS"),customer_email:z.email(),checkout_url:z.url().nullable()}).parse(await guestRpc(raw,"create_guest_payment",{p_quote_id:values.quoteId,p_reference:`CA-${randomUUID()}`,p_job_id:values.jobId??null}));
  if(["successful","refunded"].includes(payment.status))throw new ApiError(409,"This purchase is complete. View its payment status.");
  if(payment.checkout_url){const url=new URL(payment.checkout_url);if(url.protocol!=="https:"||url.hostname!=="checkout.paystack.com"||url.username||url.password)throw new ApiError(503,"Checkout is unavailable.");return {authorizationUrl:url.href,reference:payment.reference};}
  const app=new URL(process.env.NEXT_PUBLIC_APP_URL??"");if(app.protocol!=="https:")throw new ApiError(503,"Secure checkout is unavailable.");
  const authorizationUrl=await paystack.initialize({reference:payment.reference,amount:payment.charge_amount,currency:payment.charge_currency,email:payment.customer_email,callbackUrl:new URL("/api/guest-checkout/callback",app).href});
  const saved=await serviceDatabase().from("payments").update({status:"pending",checkout_url:authorizationUrl}).eq("reference",payment.reference).eq("status","initialized");
  if(saved.error)throw new ApiError(503,"Checkout status could not be saved. Check payment status before retrying.");
  return {authorizationUrl,reference:payment.reference};
}
export async function guestVerify(raw:string|null,callbackReference?:string){
  const status=await guestStatus(raw);if(!status.payment||callbackReference&&callbackReference!==status.payment.reference)throw new ApiError(404,"Checkout not found.");
  await paymentLimit(`guest-verify:${tokenDigest(raw!)}`,10,600);
  await verifyAndFulfill(status.payment.reference);
  return guestStatus(raw);
}
export async function guestClaim(raw:string|null){
  guestEnabled();const state=await guestStatus(raw);
  if(!state.payment?.claim_available)throw new ApiError(409,"Credentials are not available for initial claim. Check your payment status.");
  await paymentLimit(`guest-claim:${tokenDigest(raw!)}`,5,600);
  const {pin,pinHash}=await createApplicantPin(),sessionToken=randomBytes(32).toString("base64url");
  const claim=z.object({serial:z.string(),idle_expires_at:z.iso.datetime({offset:true}),absolute_expires_at:z.iso.datetime({offset:true})}).parse(await guestRpc(raw,"claim_guest_voucher",{p_pin_hash:pinHash,p_token_hash:tokenDigest(sessionToken)}));
  // Only this successful initial response contains the newly generated PIN.
  return {pin,sessionToken,...claim};
}

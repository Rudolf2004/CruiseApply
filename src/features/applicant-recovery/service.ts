import "server-only";
import {randomBytes} from "node:crypto";
import {z} from "zod";
import {ApiError} from "@/lib/http";
import {serviceDatabase} from "@/lib/supabase/server";
import {createApplicantPin} from "@/lib/voucher-credentials";
import {assertApplicantRollout,tokenDigest,validToken} from "@/features/applicant-auth/policy";
import {paymentLimit} from "@/features/payments/service";
import {assertRecoveryEmailConfigured,sendRecoveryEmail} from "./email";
const identifier=z.string().trim().min(8).max(100).regex(/^(CRV|CA)-[A-Za-z0-9-]+$/);
export async function requestPinReset(input:unknown,clientKey:string):Promise<()=>Promise<void>>{
  assertApplicantRollout();assertRecoveryEmailConfigured();
  const values=z.object({identifier}).strict().parse(input);
  await paymentLimit("pin-reset:request-global",120,3600);
  await paymentLimit(`pin-reset:request-client:${clientKey}`,10,3600);
  await paymentLimit(`pin-reset:identifier:${tokenDigest(values.identifier)}`,3,900);
  const code=randomBytes(32).toString("base64url"),tokenHash=tokenDigest(code),db=serviceDatabase();
  const result=await db.rpc("request_voucher_pin_reset",{p_identifier:values.identifier,p_token_hash:tokenHash});
  if(result.error)throw new ApiError(503,"PIN recovery is temporarily unavailable.");
  if(result.data===null)return async()=>{};
  const recipient=z.object({email:z.email(),serial:z.string(),expires_at:z.string()}).parse(result.data);
  // In-memory post-response delivery: no plaintext credential/token outbox.
  return async()=>{try{await sendRecoveryEmail(recipient.email,recipient.serial,code);}catch{
    const revoked=await db.rpc("revoke_voucher_pin_reset",{p_token_hash:tokenHash});
    console.warn(revoked.error?"Recovery delivery and challenge revocation failed":"Recovery delivery failed; challenge revoked");
  }};
}
export async function completePinReset(input:unknown,clientKey:string){
  assertApplicantRollout();
  const values=z.object({identifier,code:z.string().refine(validToken)}).strict().parse(input);
  await paymentLimit("pin-reset:complete-global",120,3600);
  await paymentLimit(`pin-reset:complete-client:${clientKey}`,15,900);
  await paymentLimit(`pin-reset:complete-identifier:${tokenDigest(values.identifier)}`,8,900);
  const {pin,pinHash}=await createApplicantPin();
  const result=await serviceDatabase().rpc("complete_voucher_pin_reset",{p_identifier:values.identifier,p_token_hash:tokenDigest(values.code),p_new_pin_hash:pinHash});
  if(result.error)throw new ApiError(result.error.code==="P0001"?400:503,"Unable to reset this PIN. Request a new code and try again.");
  const safe=z.object({serial:z.string()}).parse(result.data);
  return {...safe,pin};
}

import "server-only";
import { ApiError } from "@/lib/http";
export function assertRecoveryEmailConfigured(){
  if(process.env.EMAIL_PROVIDER!=="resend"||!process.env.RESEND_API_KEY||!process.env.EMAIL_FROM||/[\r\n]/.test(process.env.EMAIL_FROM))throw new ApiError(503,"PIN recovery is temporarily unavailable.");
}
export async function sendRecoveryEmail(email:string,serial:string,code:string){
  assertRecoveryEmailConfigured();
  const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({from:process.env.EMAIL_FROM,to:[email],subject:"Your CruiseApply PIN reset code",text:`A PIN reset was requested for voucher ${serial}.\n\nYour one-time verification code:\n${code}\n\nEnter this code on the CruiseApply PIN recovery page within 15 minutes. It is not your PIN. Never share this code with anyone. If you did not request this, ignore this email; your PIN and sessions have not changed.\n\nA successful reset will invalidate your previous PIN and sign out every session for this voucher.`}),signal:AbortSignal.timeout(15000),redirect:"error",cache:"no-store"});
  // Never log provider response bodies, email addresses or delivery codes.
  if(!response.ok)throw new Error("Recovery email delivery unavailable");
}

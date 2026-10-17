import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, readJson } from "@/lib/http";
import { ApplicantAuthError, assertApplicantOrigin, assertApplicantRollout, clientLimitKey, cookieToken } from "@/features/applicant-auth/policy";
import { setSession } from "@/features/applicant-auth/handlers";
import { CHECKOUT_COOKIE,guestQuote,guestInitialize,guestStatus,guestVerify,guestClaim } from "./service";
const headers={"Cache-Control":"private, no-store, max-age=0","Pragma":"no-cache","Referrer-Policy":"no-referrer","Vary":"Cookie","X-Content-Type-Options":"nosniff"};
async function handle(request:Request,operation:(raw:string|null)=>Promise<NextResponse>){try{assertApplicantRollout();if(request.method!=="GET")assertApplicantOrigin(request);else if(request.headers.get("sec-fetch-site")==="cross-site")throw new ApplicantAuthError(403);return await operation(cookieToken(request,CHECKOUT_COOKIE));}catch(error){const status=error instanceof ApplicantAuthError||error instanceof ApiError?error.status:error instanceof z.ZodError?400:503;return NextResponse.json({error:status===404?"Not found.":error instanceof ApiError?error.message:status===400?"Check your contact details and selection.":"Checkout unavailable. Please retry or contact CruiseApply."},{status,headers});}}
export const quote=(request:Request)=>handle(request,async raw=>{const result=await guestQuote(await readJson(request),clientLimitKey(request),raw);const response=NextResponse.json({quote:result.quote},{headers});response.cookies.set(CHECKOUT_COOKIE,result.raw,{secure:true,httpOnly:true,sameSite:"lax",path:"/",maxAge:86400});return response;});
export const initialize=(request:Request)=>handle(request,async raw=>NextResponse.json(await guestInitialize(raw,await readJson(request)),{headers}));
export const status=(request:Request)=>handle(request,async raw=>NextResponse.json(await guestStatus(raw),{headers}));
export const verify=(request:Request)=>handle(request,async raw=>NextResponse.json(await guestVerify(raw),{headers}));
export const claim=(request:Request)=>handle(request,async raw=>{const result=await guestClaim(raw);const response=NextResponse.json({serial:result.serial,pin:result.pin},{headers});setSession(response,result.sessionToken,result);return response;});
export async function callback(request:Request){
  try{assertApplicantRollout();}catch{return NextResponse.json({error:"Not found."},{status:404,headers});}
  const query=new URL(request.url).searchParams,reference=query.get("reference"),trxref=query.get("trxref");
  let verified=false;
  if(reference&&/^CA-[a-f0-9-]{36}$/.test(reference)&&query.getAll("reference").length===1&&query.getAll("trxref").length<=1&&(!trxref||trxref===reference)){
    try{await guestVerify(cookieToken(request,CHECKOUT_COOKIE),reference);verified=true;}catch{ /* Provider/webhook or explicit recheck can retry safely. */ }
  }
  const response=NextResponse.redirect(new URL(`/buy-voucher/result?verification=${verified?"confirmed":"pending"}`,process.env.NEXT_PUBLIC_APP_URL),303);
  for(const [k,v]of Object.entries(headers))response.headers.set(k,v);return response;
}

import "server-only";
import {after,NextResponse} from "next/server";
import {z} from "zod";
import {ApiError,readJson} from "@/lib/http";
import {APPLICANT_COOKIE,ApplicantAuthError,assertApplicantOrigin,clientLimitKey} from "@/features/applicant-auth/policy";
import {requestPinReset,completePinReset} from "./service";
const headers={"Cache-Control":"private, no-store, max-age=0","Pragma":"no-cache","Referrer-Policy":"no-referrer","Vary":"Cookie","X-Content-Type-Options":"nosniff"};
function failure(error:unknown){const status=error instanceof ApplicantAuthError||error instanceof ApiError?error.status:error instanceof z.ZodError?400:503;return NextResponse.json({error:status===404?"Not found.":status===429?"Please wait before trying again.":status===403?"This request is not permitted.":"Unable to complete recovery. Check your details or request a new code."},{status,headers});}
export async function requestRecovery(request:Request){try{assertApplicantOrigin(request);const deliver=await requestPinReset(await readJson(request),clientLimitKey(request));after(deliver);return NextResponse.json({message:"If this purchase is eligible, a reset code will be sent to its associated email address. Check your inbox and spam folder."},{status:202,headers});}catch(error){return failure(error);}}
export async function completeRecovery(request:Request){try{assertApplicantOrigin(request);const result=await completePinReset(await readJson(request),clientLimitKey(request));const response=NextResponse.json(result,{headers});response.cookies.set(APPLICANT_COOKIE,"",{secure:true,httpOnly:true,sameSite:"lax",path:"/",maxAge:0,expires:new Date(0)});return response;}catch(error){return failure(error);}}

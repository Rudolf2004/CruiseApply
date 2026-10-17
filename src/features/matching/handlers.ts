import "server-only";
import {ApiError,apiError,apiUser,assertSameOrigin,json,readJson} from "@/lib/http";
import {serviceDatabase} from "@/lib/supabase/server";
import {portalHandler} from "@/features/applicant-portal/handlers";
import {portalRpc} from "@/features/applicant-portal/service";
import {matchingCommandSchema,consentSchema,portalMatchesSchema} from "./schema";
export async function staffMatching(request:Request){
 try{assertSameOrigin(request);const {user}=await apiUser(true);const input=matchingCommandSchema.parse(await readJson(request));
 const result=await serviceDatabase().rpc("manage_matching",{p_request_id:input.requestId,p_actor_id:user.id,p_operation:input.operation,p_data:input.data});
 if(result.error){if(result.error.message==="Administrator required")throw new ApiError(403,"Staff authorization is no longer available.");if(["P0001","23505"].includes(result.error.code))throw new ApiError(409,"The record, consent or authorization changed. Refresh and review before retrying.");throw new Error("Matching unavailable");}
 return json(result.data);
 }catch(error){return apiError(error);}
}
export const loadMatches=(request:Request)=>portalHandler(request,async raw=>portalMatchesSchema.parse(await portalRpc(raw,"load_portal_matches")));
export const decideConsent=(request:Request)=>portalHandler(request,async raw=>{const input=consentSchema.parse(await readJson(request));return portalRpc(raw,"decide_portal_match_consent",{p_match_id:input.matchId,p_revision:input.revision,p_request_id:input.requestId,p_choice:input.choice});});

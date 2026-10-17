import "server-only";
import {z} from "zod";
import {database} from "@/lib/supabase/server";
import {responsesSchema} from "./schema";
// Only called after requireUser(true); the caller's staff JWT and RLS enforce reads.
export async function listStaffResponses(db:Awaited<ReturnType<typeof database>>,id:string,page=1){
  z.uuid().parse(id);z.number().int().min(1).max(10000).parse(page);
  const result=await db.from("application_applicant_commands").select("request_id,operation,body,documents,created_at",{count:"exact"}).eq("application_id",id).order("created_at",{ascending:false}).order("request_id",{ascending:false}).range((page-1)*20,page*20-1);
  if(result.error?.code==="PGRST205"||result.error?.code==="42P01")return{available:false,total:0,items:[]};
  if(result.error?.code==="PGRST103")return{available:true,total:0,items:[]};
  if(result.error)throw new Error("Applicant replies unavailable.");
  return{available:true,...responsesSchema.parse({total:result.count??0,items:result.data})};
}

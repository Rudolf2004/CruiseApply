import "server-only";
import type {SupabaseClient} from "@supabase/supabase-js";
import {serviceDatabase} from "@/lib/supabase/server";
// Pricing configuration deliberately has no direct authenticated table grants.
// Recheck the caller's database-backed staff session before server-only reads.
export async function staffPricingReader(sessionDatabase:SupabaseClient){
 const result=await sessionDatabase.rpc("is_admin");
 if(result.error||result.data!==true)throw new Error("Staff configuration access unavailable.");
 return serviceDatabase();
}

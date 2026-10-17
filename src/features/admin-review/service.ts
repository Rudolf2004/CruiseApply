import "server-only";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import { serviceDatabase } from "@/lib/supabase/server";
import { reviewSchema } from "./schema";
export async function reviewApplication(actorId: string,id: string,input: unknown) {
  z.uuid().parse(id); const data = reviewSchema.parse(input);
  const result = await serviceDatabase().rpc("review_application",{ p_request_id: data.requestId,p_actor_id: actorId,p_application_id: id,p_revision: data.revision,p_status: data.status,p_message: data.message });
  if (result.error) {
    if (result.error.message === "Administrator required") throw new ApiError(403,"Staff authorization is no longer available.");
    if (result.error.message === "Application not found") throw new ApiError(404,"Application not found.");
    if (result.error.code === "P0001" || result.error.code === "23505") throw new ApiError(409,"This decision could not be applied. Refresh the application and review its current status before making a new decision.");
    throw new Error("Review operation unavailable.");
  }
  return result.data;
}

import "server-only";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import { serviceDatabase,database } from "@/lib/supabase/server";
import { noteSchema } from "./schema";
export async function addStaffNote(actorId: string,id: string,input: unknown) {
  z.uuid().parse(id); const note = noteSchema.parse(input);
  const result = await serviceDatabase().rpc("add_application_note",{ p_request_id: note.requestId,p_actor_id: actorId,p_application_id: id,p_revision: note.revision,p_body: note.body });
  if (result.error) {
    if (result.error.message === "Administrator required") throw new ApiError(403,"Staff authorization is no longer available.");
    if (result.error.message === "Application not found") throw new ApiError(404,"Application not found.");
    if (["P0001","23505"].includes(result.error.code)) throw new ApiError(409,"Note context or retry conflict. Refresh the application before creating a new note.");
    throw new Error("Staff notes unavailable.");
  }
  return { id: result.data };
}
// Called after the staff-session guard; reads use authenticated RLS, not service role.
export async function listStaffNotes(db: Awaited<ReturnType<typeof database>>,id: string,page = 1) {
  z.uuid().parse(id); z.number().int().min(1).max(100000).parse(page);
  const result = await db.from("admin_notes").select("id,body,actor_id,created_at,context_revision",{ count: "exact" }).eq("application_id",id).order("created_at",{ ascending: false }).order("id",{ ascending: false }).range((page-1)*20,page*20-1);
  if (result.error?.code === "PGRST103") {
    const count = await db.from("admin_notes").select("id",{ count: "exact",head: true }).eq("application_id",id);
    if (count.error) throw new Error("Staff notes unavailable.");
    return { notes: [],total: count.count ?? 0,page };
  }
  if (result.error) throw new Error("Staff notes unavailable.");
  return { notes: result.data,total: result.count ?? 0,page };
}

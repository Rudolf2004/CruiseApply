import "server-only";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import { serviceDatabase } from "@/lib/supabase/server";
export async function markNotificationRead(ownerId: string, id: string) {
  z.uuid().parse(id); const db = serviceDatabase();
  const result = await db.from("notifications").update({ read_at: new Date().toISOString() })
    .eq("id",id).eq("user_id",ownerId).is("read_at",null).select("id,read_at").maybeSingle();
  if (result.error) throw new Error("Notification update unavailable.");
  if (result.data) return result.data;
  // Replays preserve the first read timestamp; foreign and absent IDs look alike.
  const existing = await db.from("notifications").select("id,read_at").eq("id",id).eq("user_id",ownerId).maybeSingle();
  if (existing.error) throw new Error("Notification lookup unavailable.");
  if (!existing.data) throw new ApiError(404,"Notification not found.");
  return existing.data;
}

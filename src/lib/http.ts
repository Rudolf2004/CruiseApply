import "server-only";
import { z } from "zod";
import { appUrl } from "./config";
import { database } from "./supabase/server";
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function assertSameOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(appUrl).origin) throw new ApiError(403, "This request is not permitted.");
}
export async function readBody(request: Request, limit = 65536): Promise<Buffer> {
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new ApiError(413, "The request is too large."); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
export async function readJson(request: Request): Promise<unknown> {
  const raw = await readBody(request);
  try { return JSON.parse(raw.toString("utf8")); } catch { throw new ApiError(400, "A valid JSON request is required."); }
}
export function json(data: unknown, status = 200) { return Response.json(data, { status, headers: { "Cache-Control": "no-store" } }); }
export function apiError(error: unknown) {
  if (error instanceof ApiError) return json({ error: error.message }, error.status);
  if (error instanceof z.ZodError) return json({ error: error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).slice(0,5).join("; ") }, 400);
  return json({ error: "We couldn’t complete this request. Please try again." }, 500);
}
export async function apiUser(admin = false) {
  const db = await database();
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) throw new ApiError(401, "Please sign in to continue.");
  const { data: profile, error: profileError } = await db.from("profiles").select("id,full_name,phone,role").eq("id",user.id).single();
  if (profileError || !profile) throw new ApiError(403, "Your profile is unavailable. Please contact support.");
  if (admin && !["admin","super_admin"].includes(profile.role)) throw new ApiError(403, "You don’t have permission to perform this action.");
  return { db, user, profile };
}

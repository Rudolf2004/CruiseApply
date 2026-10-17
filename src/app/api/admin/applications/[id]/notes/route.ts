import { z } from "zod";
import { apiError,apiUser,assertSameOrigin,json,readJson } from "@/lib/http";
import { addStaffNote,listStaffNotes } from "@/features/staff-notes/service";
export async function POST(request: Request,{ params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request); const { user } = await apiUser(true);
    return json(await addStaffNote(user.id,(await params).id,await readJson(request)));
  } catch (error) { return apiError(error); }
}
export async function GET(request: Request,{ params }: { params: Promise<{ id: string }> }) {
  try {
    const { db } = await apiUser(true);
    const page = z.coerce.number().int().min(1).max(100000).parse(new URL(request.url).searchParams.get("page") ?? 1);
    return json(await listStaffNotes(db,(await params).id,page));
  } catch (error) { return apiError(error); }
}

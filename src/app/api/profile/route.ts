import { z } from "zod";
import { apiError, apiUser, assertSameOrigin, json, readJson } from "@/lib/http";
export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const { db, user } = await apiUser();
    const values = z.object({ full_name: z.string().trim().min(2).max(200), phone: z.string().max(30) }).parse(await readJson(request));
    const { error } = await db.from("profiles").update(values).eq("id", user.id);
    if (error) throw error;
    return json({ message: "Profile saved." });
  } catch (error) { return apiError(error); }
}

import { z } from "zod";
import { ApiError, apiError, apiUser, assertSameOrigin, json, readJson } from "@/lib/http";
import { serviceDatabase } from "@/lib/supabase/server";
import { revisionSchema } from "@/features/applications/schema";
import { workflowError } from "@/features/applications/service";
type Context = { params: Promise<{ id: string; documentId: string }> };
export async function GET(_request: Request, { params }: Context) {
  try {
    const { user } = await apiUser(); const { id, documentId } = await params;
    z.uuid().parse(id); z.uuid().parse(documentId); const db = serviceDatabase();
    const result = await db.from("application_documents").select("storage_path,name,mime_type").eq("id", documentId).eq("application_id", id).eq("user_id", user.id).maybeSingle();
    if (result.error) throw new Error("Document lookup unavailable.");
    if (!result.data) throw new ApiError(404, "Document not found.");
    const file = await db.storage.from("application-documents").download(result.data.storage_path);
    if (file.error) throw new Error("Document download unavailable.");
    return new Response(file.data, { headers: { "Content-Type": result.data.mime_type, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.data.name)}`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox" } });
  } catch (error) { return apiError(error); }
}
export async function DELETE(request: Request, { params }: Context) {
  try {
    assertSameOrigin(request); const { user } = await apiUser(); const { id, documentId } = await params;
    z.uuid().parse(id); z.uuid().parse(documentId);
    const { revision } = z.object({ revision: revisionSchema }).parse(await readJson(request)); const db = serviceDatabase();
    const result = await db.rpc("remove_application_document", { p_user_id: user.id, p_application_id: id, p_revision: revision, p_document_id: documentId });
    workflowError(result.error);
    const removed = await db.storage.from("application-documents").remove([result.data.storagePath]);
    if (removed.error) console.error("Private document storage cleanup requires retry", { documentId });
    return json({ revision: result.data.revision, updatedAt: result.data.updatedAt });
  } catch (error) { return apiError(error); }
}

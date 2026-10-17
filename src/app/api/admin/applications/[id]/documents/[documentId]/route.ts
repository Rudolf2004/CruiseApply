import { z } from "zod";
import { ApiError,apiError,apiUser } from "@/lib/http";
import { serviceDatabase } from "@/lib/supabase/server";
export async function GET(_request: Request,{ params }: { params: Promise<{ id: string;documentId: string }> }) {
  try {
    const { user,db } = await apiUser(true); const { id,documentId } = await params;
    z.uuid().parse(id); z.uuid().parse(documentId);
    const record = await db.from("application_documents").select("storage_path,name,mime_type").eq("id",documentId).eq("application_id",id).maybeSingle();
    if (record.error) throw new Error("Document lookup unavailable.");
    if (!record.data) throw new ApiError(404,"Document not found.");
    const service = serviceDatabase();
    const file = await service.storage.from("application-documents").download(record.data.storage_path);
    if (file.error) throw new Error("Document download unavailable.");
    const audit = await service.from("audit_logs").insert({ actor_id: user.id,action: "application_document_downloaded",target_type: "application_documents",target_id: documentId,metadata: { application_id: id } });
    if (audit.error) throw new Error("Document access could not be recorded.");
    return new Response(file.data,{ headers: { "Content-Type": record.data.mime_type,"Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(record.data.name)}`,"Cache-Control": "private, no-store","X-Content-Type-Options": "nosniff","Content-Security-Policy": "sandbox" } });
  } catch (error) { return apiError(error); }
}

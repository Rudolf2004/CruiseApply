import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError, apiError, apiUser, assertSameOrigin, json, readBody } from "@/lib/http";
import { serviceDatabase } from "@/lib/supabase/server";
import { paymentLimit } from "@/features/payments/service";
import { documentKind, revisionSchema } from "@/features/applications/schema";
import { workflowError } from "@/features/applications/service";
import { maxDocumentBytes, validateDocument } from "@/features/applications/files";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request); const { user } = await apiUser();
    const id = z.uuid().parse((await params).id);
    const query = new URL(request.url).searchParams;
    const revision = revisionSchema.parse(Number(query.get("revision") ?? NaN));
    const kind = documentKind.parse(query.get("kind")); const name = query.get("name") ?? "";
    const mime = request.headers.get("content-type") ?? "";
    await paymentLimit(`upload:${user.id}`, 20, 600);
    const db = serviceDatabase();
    const application = await db.from("applications").select("id,status,revision").eq("id", id).eq("user_id", user.id).maybeSingle();
    if (application.error) throw new Error("Application lookup failed.");
    if (!application.data) throw new ApiError(404, "Application not found.");
    if (application.data.status !== "draft" || application.data.revision !== revision) throw new ApiError(409, "Reload the application before uploading.");
    const bytes = await readBody(request, maxDocumentBytes);
    try { validateDocument(bytes, name, mime); } catch (error) { throw new ApiError(400, (error as Error).message); }
    const documentId = randomUUID(); const path = `${user.id}/${id}/${documentId}`;
    const bucket = db.storage.from("application-documents");
    const uploaded = await bucket.upload(path, bytes, { contentType: mime, upsert: false });
    if (uploaded.error) throw new Error("Private upload unavailable.");
    const result = await db.rpc("register_application_document", { p_user_id: user.id, p_application_id: id, p_revision: revision,
      p_id: documentId, p_kind: kind, p_name: name, p_path: path, p_mime: mime, p_size: bytes.length });
    if (result.error) {
      // An HTTP timeout can hide a committed registration. Never delete its file.
      const registered = await db.from("application_documents").select("id").eq("id", documentId).eq("user_id", user.id).maybeSingle();
      // P0001 is a completed PostgreSQL exception/rollback. Transport failures
      // are ambiguous: retain an inaccessible orphan rather than break a late commit.
      if (result.error.code === "P0001" && !registered.error && !registered.data) await bucket.remove([path]);
      workflowError(result.error);
    }
    return json({ ...result.data, document: { id: documentId, kind, name, size_bytes: bytes.length } });
  } catch (error) { return apiError(error); }
}

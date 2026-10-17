import { portalDownload, portalRemove } from "@/features/applicant-portal/handlers";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context={params:Promise<{id:string;documentId:string}>};
export async function GET(request:Request,{params}:Context){const {id,documentId}=await params;return portalDownload(request,id,documentId);}
export async function DELETE(request:Request,{params}:Context){const {id,documentId}=await params;return portalRemove(request,id,documentId);}

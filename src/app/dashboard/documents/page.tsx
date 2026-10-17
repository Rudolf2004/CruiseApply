import { requireUser } from "@/lib/auth";
import { ButtonLink,Card,EmptyState,PageHeader } from "@/components/ui";
export default async function Documents({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { db,user } = await requireUser(); const params = await searchParams;
  const page = Math.floor(Math.max(1,Math.min(10000,Number(params.page) || 1))); const from = (page-1)*20;
  const { data,error,count } = await db.from("application_documents").select("id,application_id,name,kind,size_bytes,created_at",{ count: "exact" }).eq("user_id",user.id).order("created_at",{ ascending: false }).order("id").range(from,from+19);
  if (error) throw new Error("Documents unavailable.");
  return <><PageHeader title="My Documents" description="Your private application documents. Manage draft uploads inside the related application."/><div className="grid gap-4">{data.map(doc => <Card key={doc.id}><h2 className="font-semibold break-words">{doc.name}</h2><p className="muted text-sm my-3">{doc.kind.replaceAll("_"," ")} · {Math.ceil(doc.size_bytes/1024)} KB · {new Date(doc.created_at).toLocaleDateString("en-GB")}</p><div className="flex flex-wrap items-center gap-4"><a className="text-primary underline" href={`/api/applications/${doc.application_id}/documents/${doc.id}`}>Download {doc.name}</a><ButtonLink secondary href={`/dashboard/applications/${doc.application_id}`}>View application</ButtonLink></div></Card>)}</div>{!data.length && <EmptyState title="No documents yet" description="Documents uploaded inside your applications will appear here."/>}<div className="flex gap-3 mt-6">{page>1 && <ButtonLink secondary href={`?page=${page-1}`}>Previous</ButtonLink>}{from+20<(count ?? 0) && <ButtonLink secondary href={`?page=${page+1}`}>Next</ButtonLink>}</div></>;
}

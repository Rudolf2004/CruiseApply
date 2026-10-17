import { requireUser } from "@/lib/auth";
import { ButtonLink,Card,EmptyState,PageHeader,StatusBadge } from "@/components/ui";
import { applicationGuidance,applicationStatuses } from "@/features/applications/tracking";
export default async function Applications({ searchParams }: { searchParams: Promise<{ page?: string; status?: string }> }) {
  const { db,user } = await requireUser(); const params = await searchParams;
  const status = applicationStatuses.find(value => value === params.status);
  const page = Math.floor(Math.max(1,Math.min(10000,Number(params.page) || 1))); const from = (page-1)*20;
  let query = db.from("applications").select("id,reference,status,updated_at,opportunity_title_snapshot",{ count: "exact" }).eq("user_id",user.id);
  if (status) query = query.eq("status",status);
  const { data,error,count } = await query.order("created_at",{ ascending: false }).order("id").range(from,from+19);
  if (error) throw new Error("Applications unavailable.");
  const suffix = status ? `&status=${status}` : "";
  return <><PageHeader title="My Applications" description="Resume a saved draft or track your submitted candidate profile."><ButtonLink href="/voucher/verify">Activate a voucher</ButtonLink></PageHeader>
    <form className="flex flex-wrap items-end gap-3 mb-6" method="get"><label className="grid gap-2" htmlFor="application-status">Application status<select id="application-status" name="status" defaultValue={status ?? ""} className="input"><option value="">All statuses</option>{applicationStatuses.map(value => <option key={value} value={value}>{value.replaceAll("_"," ")}</option>)}</select></label><button className="button secondary" type="submit">Filter</button></form>
    <div className="grid gap-4">{data.map(application => <Card key={application.id}><div className="flex flex-wrap justify-between gap-3"><h2 className="font-bold">{application.reference}</h2><StatusBadge status={application.status}/></div><p className="mt-3 font-medium">{application.opportunity_title_snapshot}</p><p className="muted mt-3 text-sm">{applicationGuidance(application.status)}</p><p className="muted my-4 text-xs">Updated {new Date(application.updated_at).toLocaleString("en-GB")}</p><ButtonLink secondary href={`/dashboard/applications/${application.id}`}>{application.status === "draft" ? "Continue application" : "View application"}</ButtonLink></Card>)}</div>
    {!data.length && <EmptyState title={status ? "No applications with this status" : "No applications yet"} description={status ? "Choose another status or view all applications." : "Activate your voucher for an open CruiseApply opportunity to begin."}/>}
    <nav aria-label="Application pages" className="flex gap-3 mt-6">{page>1 && <ButtonLink secondary href={`?page=${page-1}${suffix}`}>Previous</ButtonLink>}{from+20<(count ?? 0) && <ButtonLink secondary href={`?page=${page+1}${suffix}`}>Next</ButtonLink>}</nav>
  </>;
}

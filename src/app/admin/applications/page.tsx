import { requireUser } from "@/lib/auth";
import { ButtonLink,EmptyState,StatusBadge } from "@/components/ui";
import { applicationStatuses } from "@/features/applications/tracking";
export default async function AdminApplications({ searchParams }: { searchParams: Promise<{ page?: string;status?: string;q?: string;sort?: string }> }) {
  const { db } = await requireUser(true); const params = await searchParams;
  const status = applicationStatuses.find(value => value === params.status);
  const q = (params.q ?? "").replace(/[^a-zA-Z0-9-]/g,"").slice(0,80);
  const page = Math.floor(Math.max(1,Math.min(10000,Number(params.page) || 1))); const from = (page-1)*20;
  const sort = params.sort === "oldest" ? "oldest" : "newest";
  let query = db.from("applications").select("id,reference,status,opportunity_title_snapshot,created_at,updated_at",{ count: "exact" });
  if (status) query = query.eq("status",status);
  if (q) query = query.ilike("reference","%"+q+"%");
  const result = await query.order("created_at",{ ascending: sort === "oldest" }).order("id").range(from,from+19);
  if (result.error) throw new Error("Candidate applications unavailable.");
  const link = (number: number) => "?"+new URLSearchParams({ page: String(number),q,status: status ?? "",sort });
  return <section className="screening-page"><header className="staff-page-heading"><h1>Candidate screening</h1><p>Find and review applications submitted to CruiseApply.</p></header>
    <form method="get" className="screening-filters">
      <label className="grid gap-2">Application reference<input name="q" defaultValue={q} maxLength={80} placeholder="e.g. APP-2026-000001"/></label>
      <label className="grid gap-2">Status<select name="status" defaultValue={status ?? ""}><option value="">All statuses</option>{applicationStatuses.map(value => <option key={value} value={value}>{value.replaceAll("_"," ")}</option>)}</select></label>
      <label className="grid gap-2">Sort<select name="sort" defaultValue={sort}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
      <button className="staff-primary-action" type="submit">Search applications</button>
    </form><p className="screening-count">{result.count ?? 0} matching {(result.count ?? 0) === 1 ? "application" : "applications"}</p>
    <div className="screening-results">{result.data.map(a => <article className="screening-candidate" key={a.id}><div><h2>{a.reference}</h2><p className="screening-opportunity">{a.opportunity_title_snapshot}</p><StatusBadge status={a.status}/><p className="screening-updated">Updated <time dateTime={a.updated_at}>{new Date(a.updated_at).toLocaleString("en-GB",{timeZone:"UTC"})} UTC</time></p></div><ButtonLink href={`/admin/applications/${a.id}`}>Review candidate</ButtonLink></article>)}</div>    {!result.data.length && <EmptyState title="No matching candidates" description="Try another reference or status."/>}
    <nav aria-label="Candidate pages" className="flex gap-3 mt-6">{page>1 && <ButtonLink secondary href={link(page-1)}>Previous</ButtonLink>}{from+20<(result.count ?? 0) && <ButtonLink secondary href={link(page+1)}>Next</ButtonLink>}</nav>
  </section>;
}


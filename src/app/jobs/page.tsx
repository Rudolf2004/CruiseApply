import type { Metadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/components/public-shell";
import { Alert, EmptyState, PageHeader } from "@/components/ui";
import { JobCard } from "@/features/jobs/job-card";
import { JobFilterForm } from "@/features/jobs/job-filters";
import { listJobs, PAGE_SIZE } from "@/features/jobs/repository";
import type { JobFilters } from "@/features/jobs/types";
export const metadata: Metadata = { title: "Cruise jobs" };
export const dynamic = "force-dynamic";
export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string,string | string[] | undefined>> }) {
  const raw = await searchParams;
  const filters: JobFilters = Object.fromEntries(Object.entries(raw).filter(([,value]) => typeof value === "string"));
  const result = await listJobs(filters);
  const pageLink = (page: number) => { const params = new URLSearchParams(); for (const [key,value] of Object.entries(filters)) if (typeof value === "string" && value) params.set(key,value); params.set("page", String(page)); return `/jobs?${params}`; };
  return <PublicShell><main id="main" className="bg-slate-50 py-14 min-h-[65vh]"><div className="container"><PageHeader eyebrow="Your next chapter" title="Find your opportunity at sea" description="Explore cruise career opportunities that match your skills, experience, and ambitions."/><JobFilterForm filters={filters}/>{result.demo && <Alert>Development preview. These sample vacancies are not live openings.</Alert>}<p className="muted text-sm my-6">{result.count} {result.count === 1 ? "opportunity" : "opportunities"} found</p>{result.jobs.length ? <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-5">{result.jobs.map(job => <JobCard job={job} key={job.id}/>)}</div> : <EmptyState title="No opportunities found" description="Try a different search or check back for newly published vacancies."/>}<nav aria-label="Job result pages" className="flex justify-center items-center gap-6 mt-9">{result.page > 1 && <Link className="button secondary" href={pageLink(result.page-1)}>Previous</Link>}<span className="text-sm muted">Page {result.page} of {Math.max(1, Math.ceil(result.count/PAGE_SIZE))}</span>{result.page*PAGE_SIZE < result.count && <Link className="button secondary" href={pageLink(result.page+1)}>Next</Link>}</nav></div></main></PublicShell>;
}

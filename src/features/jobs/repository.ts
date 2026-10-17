import "server-only";
import { createClient } from "@supabase/supabase-js";
import { demoMode, hasSupabase, supabasePublicKey } from "@/lib/config";
import { sampleJobs } from "./sample-data";
import type { Job, JobFilters } from "./types";
export const PAGE_SIZE = 12;
function publicDatabase() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, supabasePublicKey!, { auth: { persistSession: false } }); }
export async function listJobs(filters: JobFilters = {}) {
  const page = Math.max(1, Math.min(10000, Number.parseInt(filters.page ?? "1", 10) || 1));
  if (demoMode) {
    const jobs = sampleJobs.filter(job => (!filters.q || `${job.title} ${job.company} ${job.summary}`.toLowerCase().includes(filters.q.toLowerCase())) &&
      (!filters.category || job.category === filters.category) && (!filters.department || job.department === filters.department) &&
      (!filters.company || job.company === filters.company) && (!filters.location || job.location === filters.location));
    if (filters.sort === "title") jobs.sort((a,b) => a.title.localeCompare(b.title));
    return { jobs: jobs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), count: jobs.length, page, configured: true, demo: true };
  }
  if (!hasSupabase) return { jobs: [] as Job[], count: 0, page, configured: false, demo: false };
  let query = publicDatabase().from("jobs").select("*", { count: "exact" }).eq("status", "published").eq("sample", false).eq("opportunity_type", "managed");
  if (filters.featured) query = query.eq("featured", true);
  for (const key of ["category", "department", "company", "location"] as const) if (filters[key]) query = query.eq(key, filters[key]!.slice(0,150));
  const q = filters.q?.replace(/[^\p{L}\p{N}\s-]/gu, " ").trim().slice(0,100);
  if (q) query = query.or(`title.ilike.%${q}%,company.ilike.%${q}%,summary.ilike.%${q}%`);
  const { data, count, error } = await query.order(filters.sort === "title" ? "title" : "created_at", { ascending: filters.sort === "title" }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (error) throw new Error("Vacancies are temporarily unavailable. Please try again.");
  return { jobs: data as Job[], count: count ?? 0, page, configured: true, demo: false };
}
export async function getJob(slug: string): Promise<Job | null> {
  if (demoMode) return sampleJobs.find(job => job.slug === slug) ?? null;
  if (!hasSupabase) return null;
  const { data, error } = await publicDatabase().from("jobs").select("*").eq("slug", slug).eq("status", "published").eq("sample", false).eq("opportunity_type", "managed").maybeSingle();
  if (error) throw new Error("This vacancy is temporarily unavailable.");
  return data as Job | null;
}

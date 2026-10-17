import { employerLabel } from "@/features/jobs/service-description";
import Link from "next/link";
import { ArrowRight, Clock3, Cog, MapPin, Monitor, Ship, UserRound, Utensils } from "lucide-react";
import type { Job } from "./types";
export function JobCard({ job }: { job: Job }) {
  const Icon = job.category === "Information Technology" ? Monitor : job.category === "Food & Beverage" ? Utensils : job.category === "Technical Operations" ? Cog : UserRound;
  return <Link href={`/jobs/${job.slug}`} className="card group hover:border-blue-200 hover:shadow-md transition-all flex flex-col gap-5 p-5"><div className="flex items-start gap-4"><div className="rounded-full p-4 bg-blue-50 text-[#155aa5] shrink-0"><Icon size={28}/></div><div className="pt-1"><h3 className="font-bold text-[15px] group-hover:text-primary">{job.title}</h3><p className="muted text-sm mt-2">{job.category}</p></div></div><p className="flex items-center gap-3 text-sm pl-1"><Ship size={20} className="text-primary"/>{employerLabel(job.company)}</p>{job.sample && <span className="text-xs text-amber-800 bg-amber-50 px-2 py-1 rounded w-fit">Sample vacancy · not a live opening</span>}<div className="flex items-center gap-3 text-xs muted mt-auto pt-2"><span className="flex items-center gap-1.5"><MapPin size={17}/>{job.location}</span><span className="flex items-center gap-1.5"><Clock3 size={17}/>{job.contract_duration}</span><ArrowRight className="ml-auto text-primary shrink-0" size={18}/></div></Link>;
}

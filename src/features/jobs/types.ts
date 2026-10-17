export interface Job {
  id: string; title: string; slug: string; company: string | null; category: string; department: string;
  opportunity_type: "managed" | "research"; service_description: string | null;
  summary: string; description: string; responsibilities: string[]; requirements: string[];
  preferred_qualifications: string[]; minimum_age: number | null; experience_requirement: string | null;
  education_requirement: string | null; contract_duration: string; salary_text: string | null;
  currency: string | null; location: string; region: string | null; application_deadline: string | null;
  openings: number | null; featured: boolean; status: "draft" | "published" | "paused" | "closed" | "archived";
  sample: boolean; questions: { id: string; label: string; required: boolean }[]; created_at: string; updated_at: string;
}
export interface JobFilters { q?: string; category?: string; department?: string; company?: string; location?: string; sort?: string; page?: string; featured?: boolean; }

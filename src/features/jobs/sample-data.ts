import type { Job } from "./types";
// Explicit development fixtures. Never used as fallback for a failed database request.
export const sampleJobs: Job[] = [
  ["Assistant IT Officer", "Information Technology", "Technology"],
  ["Restaurant Attendant", "Food & Beverage", "Hospitality"],
  ["Maintenance Technician", "Technical Operations", "Engineering"],
  ["Guest Service Agent", "Guest Services", "Hospitality"]
].map(([title, category, department], i) => ({
  id: `00000000-0000-4000-8000-00000000000${i + 1}`, title, category, department, opportunity_type: "research", service_description: null,
  slug: `sample-${title.toLowerCase().replaceAll(" ", "-")}`, company: "Sample cruise employer",
  summary: "Explore an illustrative onboard career opportunity. This is development data, not a live vacancy.",
  description: "This sample role demonstrates how opportunities will appear on CruiseApply. It is not a live vacancy and does not represent a relationship with an employer.",
  responsibilities: ["Collaborate with an international team", "Maintain high standards of service and safety"],
  requirements: ["Relevant professional experience", "Clear communication skills"], preferred_qualifications: [],
  minimum_age: null, experience_requirement: null, education_requirement: null, contract_duration: "6–8 Months",
  salary_text: null, currency: null, location: "Worldwide", region: null, application_deadline: null,
  openings: null, featured: true, status: "published", sample: true, questions: [],
  created_at: "2026-09-28T00:00:00Z", updated_at: "2026-09-28T00:00:00Z"
}));

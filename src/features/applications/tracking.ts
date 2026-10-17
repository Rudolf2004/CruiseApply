export const applicationStatuses = ["draft","submitted","under_review","additional_information_required","shortlisted","interview","final_review","accepted","unsuccessful","withdrawn"] as const;
const guidance: Record<typeof applicationStatuses[number],string> = {
  draft: "Complete your draft, review your details and submit it to CruiseApply when ready.",
  submitted: "CruiseApply has received your application for screening. Watch your notifications for updates.",
  under_review: "CruiseApply is reviewing your candidate profile. Any request for information will appear in your updates.",
  additional_information_required: "Review the latest message below for the information requested and how to provide it. Your submitted application remains read-only.",
  shortlisted: "CruiseApply has shortlisted your candidate profile. This does not guarantee an employer referral, interview or employment.",
  interview: "Review the latest message for interview details and who is conducting it. This status alone is not an employer offer.",
  final_review: "Your candidate profile is in final review. Watch for a decision or further instructions from CruiseApply.",
  accepted: "Accepted/qualified through CruiseApply's internal screening. This does not mean you have been hired, employed or selected by a cruise company, and does not guarantee employer referral. Read the screening decision below.",
  unsuccessful: "This application was not selected. Review the decision message below for details.",
  withdrawn: "This application is withdrawn and is no longer progressing through screening.",
};
export function applicationGuidance(status: string): string {
  return guidance[status as keyof typeof guidance] ?? "Review your latest application updates below.";
}

export const applicationServiceDescription = "Application access covers submitting your candidate profile and supporting documents to CruiseApply for review and screening. CruiseApply may contact qualified or shortlisted candidates and assess suitable employer or recruitment-partner opportunities for matching or referral. This payment is for CruiseApply's own service; it is not a cruise line's application or recruitment fee. Submission does not guarantee qualification, shortlisting, referral, an interview or employment. Employers make their own recruitment and hiring decisions.";
export function employerLabel(company: string | null) {
  return company || "CruiseApply screening — employer matching follows review";
}

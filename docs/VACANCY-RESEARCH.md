# Official-source vacancy research — September 29, 2026

The owner requested actual vacancies instead of the proposed temporary integration vacancy. Four Carnival detail pages displayed an Apply action when reviewed:

| Role | Official source | Notes |
| --- | --- | --- |
| 2nd Engineer | https://shipjobs.carnival.com/job/2nd-engineer/22 | Source has inconsistent experience thresholds: three watchkeeping years in detailed requirements, five similar-role years in the summary. Preserve that uncertainty. |
| 2nd ETO | https://shipjobs.carnival.com/job/2nd-eto/534 | STCW III/6 and cruise electro-technical experience specified. |
| Public Health Officer | https://shipjobs.carnival.com/job/public-health-officer/99 | Relevant scientific background and public-health programme experience specified. |
| Commis Team Dining | https://shipjobs.carnival.com/job/commis-team-dining/186 | Culinary basics, English and relevant kitchen experience specified. |

The source pages, rather than search snippets or department pages, determine availability. Demi Chef de Partie (61), Assistant Garde Manger (875) and Specialty Restaurant Manager Portside South Africa 2026 (982) displayed Job Unavailable and were excluded, even though the search index listed them. Recheck availability before publication. No salary, deadline, vessel assignment or contract length was invented. Country eligibility is not inferred from CruiseApply's worldwide pricing-country catalog.

The reproducible import is `node --env-file=.env.local scripts/import-researched-vacancies.mts --drafts-only`; it reads [researched-vacancies.json](../supabase/configuration/researched-vacancies.json), inserts only missing slugs, and never overwrites existing listings. Drafts include short original summaries, official source URLs, checked date and independent-platform wording. No employer logos or full copied descriptions were imported.

## Publication decision

[Carnival's official site](https://shipjobs.carnival.com/search) states that Carnival and its authorized crewing partners do not charge recruitment or deployment fees. [MSC's FAQ](https://careers.msccruises.com/gb/en/msccruises/onboard-roles) and [Princess's application guidance](https://www.princess.com/en-uk/careers/shipboard-cruise-jobs/how-to-apply) similarly identify their official application routes and no-fee recruitment policies. No employer authorization for CruiseApply has been supplied.

These draft listings must not be treated as authorization to collect employer applications through a mandatory paid voucher. Proposed publication behavior: a free, direct official-employer application link; any independently purchased CruiseApply support would be separately and specifically described. An internal CruiseApply submission must not claim receipt or review by the employer. This requires the owner's product decision and implementation of separate application routing before publication.

The original paid voucher remains unused. Finding actual vacancies does not authorize sending fabricated integration-test applications to employers. The temporary test job remains unapproved and uncreated; its script has not run. Paystack remains Test Mode only.

## Owner decision (supersedes the publication proposal above)

CruiseApply will operate managed candidate sourcing, screening and employer-matching opportunities, not primarily external job links. The four researched Carnival rows were successfully inserted as unpublished drafts and must remain unpublished research. Do not publish them or run the consuming application test against them. See MANAGED-OPPORTUNITIES.md and the prepared, unapplied migration 0005. The initial application has no mandatory employer association.
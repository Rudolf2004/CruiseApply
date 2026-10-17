# CruiseApply-managed screening and matching

The owner's clarified model is:

Opportunity → application access → application wizard → documents → submission → CruiseApply review → qualification/shortlisting → employer matching/referral.

An initial opportunity is a CruiseApply-managed role or category. It need not identify an employer. Submission is to CruiseApply for its review; it is not proof of an employer application, referral, interview or hiring decision. Final recruitment and hiring decisions remain with employers.

## Migration 0005 — applied by the owner

Review [202609290005_managed_opportunities.sql](../supabase/migrations/202609290005_managed_opportunities.sql). It:

- Makes the existing `jobs.company` field optional; the existing table continues to hold opportunity categories without a destructive rename.
- Explicitly classifies rows as `managed` or `research`. Existing rows default to research. Only managed rows with a meaningful service description can be published. No rows are published or automatically declared authorized.
- Adds source metadata and snapshots the opportunity title/service description when an application starts. It prevents subsequent reassignment of application ownership, vacancy, voucher or service snapshots. Existing historical applications are not given invented descriptions.
- Adds employers, their separately verified opportunities, and candidate matches for the later admin workflow. Matching does not alter the original application or voucher. Internal matching records are admin-readable, with service-only writes and RLS retained. No external referral or candidate data sharing is performed by this migration.
- Keeps existing application status/history, paid access, Paystack verification/idempotency, quotes and voucher credentials unchanged.

The existing four Carnival research rows remain unpublished drafts. They are not CruiseApply-managed vacancies or evidence of recruitment authorization. The temporary integration test vacancy was not approved and has not been created.

## Historical application instructions (already completed)

In the CruiseApply Supabase project, open **SQL Editor → New query**, review and run the complete migration 0005 once. Do not rerun migrations 0001–0004. Then run:

```sql
select column_name, is_nullable from information_schema.columns
where table_schema = 'public' and table_name = 'jobs'
and column_name in ('company','opportunity_type','service_description','source_url','source_checked_at');

select title,status,opportunity_type from public.jobs
where slug in ('carnival-2nd-engineer-22','carnival-2nd-eto-534',
  'carnival-public-health-officer-99','carnival-commis-team-dining-186');

select tablename,rowsecurity from pg_tables where schemaname = 'public'
and tablename in ('employers','employer_opportunities','application_matches');
```

Expected: five column rows with company nullable; four Carnival rows still `draft/research`; all three new tables have RLS enabled. If the migration reports a published-opportunity constraint violation, do not disable it: a public job was added since the last check and needs explicit classification first.

## Implemented after migration application

Opportunity types, optional employer rendering, filters and validation are implemented. Purchase, redemption and application pages show the configured screening service description. Confirmation distinguishes submission to CruiseApply from employer hiring. The approved managed category completed the original-owner redemption/wizard/submission flow; see [final E2E results](APPLICATION-E2E.md). Later employer referral remains separate from internal application status.

Proposed service wording based on the owner's clarification:

“Application access covers submitting your candidate profile and supporting documents to CruiseApply for review and screening. CruiseApply may contact qualified or shortlisted candidates and assess suitable employer or recruitment-partner opportunities for matching or referral. This payment is for CruiseApply's own service; it is not a cruise line's application or recruitment fee. Submission does not guarantee qualification, shortlisting, referral, an interview or employment. Employers make their own recruitment and hiring decisions.”

This wording must describe the service actually delivered; relabelling a charge alone does not establish employer authorization. No Live Mode or employer affiliation is enabled. Admin qualification/referral actions and their audit/consent flow remain future implementation, not completed features.

## Approved managed intake and completed verification

The owner approved Hospitality & Guest Services — Candidate Screening as a genuine CruiseApply intake, without an employer, mandatory documents, additional eligibility rules, salary, ship assignment, contract offer or openings. It was configured through scripts/configure-managed-intake.mts. Carnival records remain draft/research. Managed opportunity pages, purchase and redemption show the screening service; applications display the immutable service snapshot and distinguish CruiseApply submission from employer hiring.

Original voucher CRV-2026-00000003 has been redeemed under its owner into APP-2026-00000001. The application was submitted through the browser on September 30, 2026; one education record, one experience record and two optional private test documents are retained. No employer matches exist. See APPLICATION-E2E.md for the completed checks and current final access-review status. No new payment was initialized.

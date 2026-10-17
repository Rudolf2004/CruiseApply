-- REVIEW ONLY. NOT APPLIED. Requires explicit approval for a temporary public test job.
-- No payment, voucher, application, or credential mutations.
-- Archive immediately after the original test applicant completes integration tests.
begin;
insert into public.jobs (
  title, slug, company, category, department, summary, description,
  contract_duration, location, status, sample, featured, minimum_age,
  application_deadline, questions, required_documents
) values (
  'CruiseApply integration test — not a vacancy',
  'cruiseapply-application-integration-test',
  'CruiseApply internal testing', 'Internal testing', 'Quality assurance',
  'Internal application workflow test only. This is not an employment opportunity.',
  'This record exists solely to verify the original test applicant''s voucher redemption, autosave, private uploads and final submission. It is not a job offer and does not represent any cruise line. Do not purchase a voucher for this test.',
  'Not applicable — test only', 'Internal test only', 'published', false, false, 18,
  now() + interval '1 day',
  '[{"id":"test-confirmation","label":"Confirm that this is an internal test application, not an employment application.","required":true}]'::jsonb,
  array['cv']::text[]
);
commit;

-- After tests, retain the linked record but remove it from published listings:
-- update public.jobs set status = 'archived', updated_at = now()
-- where slug = 'cruiseapply-application-integration-test';

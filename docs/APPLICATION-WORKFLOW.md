# Application workflow — migration review

Migration 0004 was applied successfully by the project owner on September 29, 2026. Do not reapply it. Migrations 0001–0003 and the approved GHS 150 Test Mode pricing configuration must not be rerun. No Paystack provider or fulfillment code was changed for this phase.

## Implemented source

- `/voucher/verify` verifies the signed-in owner's serial/PIN, rate-limits attempts and calls the existing `redeem_verified_voucher()` operation. Retries can recover only the existing application for that same owner, voucher and vacancy. The plaintext PIN never enters a URL or log.
- `/dashboard/applications` lists owned applications with pagination. `/dashboard/applications/[id]` provides personal information, identification, education, experience, selected vacancy, documents, configurable questions, review and declaration/submission. `/application` and `/application/status` lead to the owned application list.
- Drafts autosave every two seconds when changed and before wizard navigation. Writes are serialized in the browser and carry an expected database revision. A stale tab receives a conflict instead of overwriting another save. Save failures remain visible; sensitive drafts are not copied into local storage. Closing a dirty page warns, and link navigation first attempts to save.
- Education and experience retain their entered ordering. Empty drafts are allowed; complete submission uses stricter validation. Required questions use the job's existing `questions` JSON: `{ "id": "availability", "label": "When can you start?", "required": true }`. Duplicate IDs are rejected by the application.
- Files are uploaded through an authenticated, same-origin server endpoint into the existing private bucket. PDF/JPEG/PNG MIME types, extensions, signatures, names and a 10 MB bound are checked. Each application allows at most 20 documents. Downloads require the owner on every request, use attachment disposition and disable caching. File signature validation is not malware scanning.
- Document registration/deletion and final submission lock the same parent application row as autosave. Files uploaded during a conflicting submission cannot become application documents. A storage/DB interruption may leave an inaccessible orphan; ambiguous registration failures deliberately retain the file to avoid deleting a potentially committed document. Failed deletion cleanup logs the document ID for operational retry. Automated orphan reconciliation and malware scanning remain release considerations, not completed features.
- Submission requires the declaration and a fully validated saved revision. The transaction rechecks the vacancy, voucher, age, required answers and documents, records submission/history/audit/notification exactly once, and makes subsequent applicant mutations read-only. The existing application reference assigned during redemption is retained. Voucher expiry governs activation; it does not introduce a new deadline after activation. Vacancy deadlines still govern submission.

## Historical migration instructions — already completed

1. Open the **CruiseApply** project in Supabase → **SQL Editor** → **New query**.
2. Review and run the complete contents of [202609290004_application_workflow.sql](../supabase/migrations/202609290004_application_workflow.sql) once. This adds revision/order columns, an empty per-job required-document configuration, and four service-role-only operations. It does not alter payments, pricing, voucher credentials, existing fulfillment functions, RLS policies or bucket visibility.
3. Confirm the transaction completes successfully. Then run this read-only check:

```sql
select table_name, column_name
from information_schema.columns
where table_schema = 'public' and
  ((table_name = 'applications' and column_name = 'revision')
   or (table_name in ('application_education','application_experience') and column_name = 'sort_order')
   or (table_name = 'jobs' and column_name = 'required_documents'));

select p.proname,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as applicant_can_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_can_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in
  ('save_application_draft','register_application_document',
   'remove_application_document','submit_application');
```

Expected: four column rows and four function rows; permissions `false / false / true` for every function. No initial required-document rules or new vacancies are inserted by this migration.

## Verification boundary

Hosted checks confirmed all four new columns, all four service-only RPCs, anonymous/applicant execute denial, absent-application rejection and the private bucket. The owner subsequently approved a genuine CruiseApply-managed Hospitality & Guest Services intake under migration 0005. Original-owner voucher `CRV-2026-00000003` was redeemed and application `APP-2026-00000001` submitted. See [current E2E results](APPLICATION-E2E.md) for the verified flow and remaining test limits. Do not rerun the non-consuming runner against this now-used voucher.

After application, test: same-voucher concurrent redemption; draft resume and stale-write conflicts; owner/foreign document access; file rejection; upload-versus-submit races; missing requirements; repeated final submission yielding one history entry/notification; and refusal to edit after submission. The non-consuming runner is `node --conditions=react-server --env-file=.env.local scripts/verify-redemption.mts` and uses the ignored original checkout test state. It does not initialize transactions or fabricate fulfillment.

Actual provider-delivered webhooks still require public HTTPS, as documented in [PAYSTACK-E2E.md](PAYSTACK-E2E.md). This is separate from the application workflow migration. Paystack remains in Test Mode.

## Latest checks and vacancy decision

Before redemption, the non-consuming hosted/browser runner passed authentication, same-origin, PIN rejection, invalid-job rollback and mobile layout checks without changing application or notification counts. Fixed the shared button CSS layer so responsive hiding works, and adjusted header spacing for small screens. The voucher was subsequently used in the approved managed-intake E2E flow.

The proposed temporary test-job SQL was not applied. Four researched Carnival roles remain unpublished research drafts; see VACANCY-RESEARCH.md. The owner clarified the managed screening/matching model and approved the independent CruiseApply intake used by the consuming E2E runner. No job application or referral has been sent to an employer.

# Migration 0014: employer matching and consent (review only)

Review [202610040014_employer_matching.sql](../supabase/migrations/202610040014_employer_matching.sql). This migration is prepared, not applied. Migration 0013 is [fully hosted-verified](APPLICANT-ACTIONS-0013-HOSTED.md), including fixture cleanup and preservation of the original records.

## What changes

The migration extends the existing 0005 employer/opportunity/match tables with optimistic revisions, an authorized recipient address, and employer-specific consent state/scope. It adds a private command ledger, indexes, consent consistency constraints and immutable match identity protection. Three service-only operations manage staff actions, record a voucher-scoped applicant consent decision and load applicant-visible matching requests. The trigger function is not directly executable by API roles.

No existing business row is updated or backfilled by a DML statement. Added columns have compatibility defaults: existing matches acquire revision zero and no recorded consent; historic referral status is not rewritten or treated as newly authorized. No employer, opportunity, match, consent or referral is seeded. All changes are transactional; local injected-failure checks verify rollback.

## Workflow and security

- Staff actors come only from verified Supabase sessions. The RPC rechecks admin/super_admin against the database and locks that role. Anonymous/authenticated JWTs cannot call the RPC directly.
- Employer editing, opportunity research/verification, match creation/transitions, consent requests and recording a completed referral use immutable request IDs. Matching command UPDATE is not granted to the service role. Identical retries return the original result; changed actors/payloads conflict. Revisions detect stale edits.
- An application must be internally `accepted`/qualified before a match can be proposed. This is not hiring or an employer offer. Match transitions are proposed → qualified → shortlisted → referred, with explicit closure. Matching never changes application screening status.
- Proposed matches require a verified source. Requesting consent also requires recorded referral authorization evidence and an authorized recipient. Research does not imply recruitment permission.
- A consent request snapshots the employer, recipient, role/source, employer/opportunity/application revisions, the explicit profile fields and selected application document IDs/names. Only documents owned by that application may be included. Name, contact information, nationality, residence country, education and experience are listed; passport/identification details are not automatically included. Staff must select any documents separately.
- Only the exact voucher session may grant, decline or revoke its application’s consent. There is no email-based ownership. Decisions require a current match revision and explicit confirmation in the UI. Disabled/revoked sessions remain denied through the existing portal boundary.
- Changed employer/opportunity/application revisions invalidate old consent for granting or referral recording. A fresh request and applicant decision are required. Closing a pending/granted match revokes its permission.
- Referral recording requires current granted consent, internal qualification, a verified/authorized opportunity and a staff-entered reference/evidence of a referral already completed through the verified employer channel. **This operation does not send candidate data, generate a referral package, email an employer or integrate with an employer system.** A referral record is a staff attestation, not independent proof of delivery.
- Applicants can revoke future sharing permission after a referral is recorded; information already received externally cannot be recalled by the control. Declining consent does not change the screening decision or payment.
- Internal authorization/referral evidence remains in staff-only records. Matching command SELECT uses admin RLS; ordinary authenticated applicants see no rows. Applicant DTOs expose only the intended consent scope, not staff evidence, command payloads, credentials or storage paths. Audit metadata contains request IDs/revisions, not evidence or candidate data.

Locks follow staff role/request serialization and application → match → employer → opportunity; applicant operations retain the existing voucher/session scope first. Staff opportunity editing locks employer before opportunity. No old RLS policy or payment/fulfillment operation is replaced.

## Implemented interfaces

- `/admin/employers`: employer and opportunity research/verification forms, authorization evidence and recipient management.
- Staff candidate page: propose/qualify/shortlist/close a match, choose consent documents, request consent, inspect internal matching history and record a completed referral.
- Applicant application page: view exact employer-specific sharing requests and grant/decline/revoke permission behind the existing disabled rollout.

The administrative selectors currently display up to 100 employers/opportunities; comprehensive search/pagination is still part of the remaining administration workstream. No researched Carnival draft is published or represented as CruiseApply-authorized recruitment.

## Validation and limits

Local exact PostgreSQL tests cover transactional installation/rollback, unchanged legacy data, service/staff permissions, request replay/conflicts, qualification gates, exact document scope, stale consent rejection, referral recording, revocation, applicant isolation and safe audit metadata. These use isolated fictional local fixtures and transmit nothing.

The prepared hosted `--matching-stage` runner tests permissions, role revocation, concurrent identical employer saves, retries, research-only opportunity rejection and the unassigned applicant view. It removes temporary private research records and compares all original public-table snapshots. It deliberately does not fabricate a hosted verified employer, candidate match or referral. Positive hosted consent/referral E2E requires a legitimate authorized opportunity and a controlled applicant; it must not be claimed passed from local tests alone.

The read-only verifier includes exact function definitions, security settings, individual table privileges, matching column types/defaults, RLS/policies, constraints, indexes and triggers. The comparison script normalizes only the documented PostgreSQL NOT NULL catalog representation and array/order/line endings.

## Manual step

1. Review and run only `supabase/migrations/202610040014_employer_matching.sql` in the existing Supabase SQL Editor as `postgres`. Expected: `Success. No rows returned.` Do not rerun migrations 0001-0013.
2. Run `supabase/configuration/verify-0014-readonly.sql` and save the complete JSON as `supabase/configuration/verification_0014.json`.
3. I will compare the catalog, run the safe hosted authorization/retry/research-state checks, clean up, then continue the remaining administration/reporting work. Applicant rollout remains disabled and Paystack remains in Test Mode.

No external employer communication, payment, hosted 0014 operation or production activation has occurred. After application, preserve consent/command evidence and fix forward; do not roll back by deleting recorded applicant decisions.

Final preparation checks (2026-10-10): exact local SQL/rollback/preservation and expanded catalog checks passed; recorded TypeScript, 166 unit tests and production build passed; final full lint and disabled-route production HTTP/Edge checks at 390px and 1440px passed. No application source changed after the successful build. The first browser startup timed out; the isolated retry passed. Hosted 0014 and positive enabled matching/referral E2E are not claimed as verified.

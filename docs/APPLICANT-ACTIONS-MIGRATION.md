> Applied and fully hosted-verified on 2026-10-04. See [evidence](APPLICANT-ACTIONS-0013-HOSTED.md). Earlier preparation/manual steps below are historical; do not rerun 0013.

# Migration 0013: applicant replies and withdrawal (review only)

Run [202610040013_applicant_responses_withdrawal.sql](../supabase/migrations/202610040013_applicant_responses_withdrawal.sql) manually only after review. Migrations 0001-0012 are applied; [0012 hosted recovery verification passed](VOUCHER-RECOVERY-0012-HOSTED.md).

## Scope

This stage implements the approved applicant additional-information response and explicit withdrawal workstream. It does not implement employer matching, change payment/voucher state, reopen the original submission, enable applicant rollout or send email.

The migration creates one private, immutable request/result table, its indexes, a binding trigger and four service-only operations. It performs no business-row DML and replaces no existing function or RLS policy. Everything installs in one transaction; a failure rolls back the complete migration.

- `portal_response_upload_context`: authenticates the voucher session, locks its exact application, checks the additional-information status and expected revision, and derives a unique private upload path. Only the server receives that path.
- `submit_portal_response`: accepts a 10-4000 character reply and up to five previously uploaded attachments (10 MB each, PDF/JPEG/PNG). It checks the scoped storage path and actual stored MIME/size, then adds document records, records the immutable response, advances the application to `under_review`, and writes history, one notification and a principal-attributed audit atomically. Existing personal details, education, experience and declaration/submission snapshots stay unchanged.
- `withdraw_portal_application`: accepts an authenticated applicant's explicit withdrawal reason and expected revision. It moves a nonterminal application (including a draft) to `withdrawn`, with applicant attribution. Accepted, unsuccessful and already withdrawn applications cannot be reopened or newly withdrawn through this operation; identical withdrawal retries remain idempotent. Withdrawal does not refund a payment or restore voucher use. Existing cancelled/refunded applications can be withdrawn while their access session remains valid.
- `load_portal_responses`: returns only that voucher's application replies/withdrawals, with 20-item pagination. No private staff notes, access credentials or storage paths are returned.

The server requires explicit checkbox confirmation for withdrawal, rejects browser actor/owner/proof fields, hashes only the session cookie, enforces rollout/origin/authentication/rate limits and validates upload bytes before private storage. Successful reads/writes refresh the bounded secure cookie through the existing portal boundary. Replies and withdrawal share the application lock/revision with staff screening. Staff screening still cannot choose `withdrawn`.

## Isolation and retries

New-table RLS permits SELECT only for authenticated database-role admins/super-admins. Ordinary applicants see no rows; anon has no table privileges. Authenticated users have no writes, and no authenticated/anon role can execute the new operations. Service-role table UPDATE is denied, and a trigger also rejects updates by privileged callers. Deletion remains service-only for controlled fixture cleanup/retention, never an applicant endpoint.

A request UUID identifies the immutable operation, application/access principal, original revision, exact body and attachment metadata. Identical retries return the original result without reapplying writes. Reusing a key with different input fails. Cross-application collisions roll back. Audits contain identifiers/revisions/counts, never the reply/reason body, filenames or file contents. Applicant withdrawal reasons are visible in that application's status history; reply bodies are available only in scoped reply history and staff review.

Replies require existing paid write entitlement; withdrawal/tracking use the separate valid-session read scope. A revoked/suspended access, disabled principal or expired/revoked session always fails. Used-voucher ordinary expiry does not block tracking. Same-email vouchers never establish ownership of each other.

## Documents and operations

Response attachments reuse the private application-documents bucket and existing scoped applicant/staff downloads, including staff download auditing. Paths are derived from immutable application ownership, application UUID, request UUID and a server-generated document UUID. No public/signed download link is introduced. New attachments append to the application; the original submitted documents remain unchanged. The total application document ceiling for reply additions is 50 (five per reply); draft limits remain unchanged.

An interrupted or abandoned upload can leave an unregistered private object. It is not returned by application APIs and cannot be downloaded through them. Existing operational orphan reconciliation must include the `/responses/` prefix: remove only old objects proven absent from `application_documents`, never in-flight uploads or objects whose registration is uncertain. Automated deletion is not enabled by this migration. File signature/type/size validation is not a malware scanner; malware-scanning deployment remains a production-hardening consideration.

The UI keeps submitted retry payloads fixed in memory. An ambiguous send is retried with the same request UUID; a reload loads committed state before a new action. No applicant data or credentials are persisted in browser storage by these forms.

## Validation

Local exact-SQL checks cover transactional rollback, no migration-time business changes, permissions, staff-only RLS, scope/revision denial, missing/mismatched storage, immutable submission, retry conflicts, single notifications/audits, terminal protections and safe audit metadata. HTTP tests cover disabled rollout, staff-cookie denial, origin/actor forgery, session proofs, confirmation, validated uploads, revocation and limits. Full validation results are recorded in IMPLEMENTATION.md.

Hosted 0013 tests are prepared but cannot be run before manual application. They will exercise concurrent identical replies and withdrawals, original-record preservation, RLS/permissions, real private storage metadata and cleanup. Local embedded PostgreSQL has one connection and is not claimed as a real multi-connection concurrency test. Real enabled browser E2E remains a later controlled release check.

## Manual Supabase step

1. Review and run only `supabase/migrations/202610040013_applicant_responses_withdrawal.sql` in the existing project's SQL Editor as `postgres`. Expected: `Success. No rows returned.`
2. Run `supabase/configuration/verify-0013-readonly.sql`, then save the complete JSON as `supabase/configuration/verification_0013.json`.
3. I will compare the exact hosted catalog, run the prepared disposable-fixture concurrency/isolation/storage checks, clean them up, and continue employer qualification/matching workflows. Keep rollout disabled and Paystack in Test Mode; no payment or email is needed for these checks.

Do not rerun previous migrations. No hosted 0013 operation has been performed during preparation. Future rollback must preserve recorded applicant requests; disable affected routes and fix forward instead of deleting response history.

Final local results (2026-10-04): exact SQL/rollback/catalog checks, TypeScript, full lint, all 156 tests, production build and disabled-boundary HTTP/Edge checks at 390px and 1440px passed. Attachment metadata mismatch is explicitly tested. No hosted 0013 call or migration application occurred.

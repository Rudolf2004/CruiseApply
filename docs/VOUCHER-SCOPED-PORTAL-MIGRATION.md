> Current status: 0010 was manually applied and is fully hosted-verified. See [hosted evidence](VOUCHER-PORTAL-0010-HOSTED.md). Pre-application instructions below are historical; do not rerun 0010.

# Migration 0010: voucher-scoped portal operations — review only

File: [202610030010_voucher_scoped_portal.sql](../supabase/migrations/202610030010_voucher_scoped_portal.sql).

Status: prepared locally, not applied to hosted Supabase. This is the first grouped database dependency for Phase A. It does not enable the rollout or complete the portal UI. Migrations 0001-0009 remain applied; 0008 and 0009 are fully hosted-verified. The central [implementation tracker](IMPLEMENTATION.md) separates earlier delivery from the revised Phase A-L work order.

## Audit of the existing implementation

| Existing surface | Current authorization | Required voucher boundary |
| --- | --- | --- |
| Dashboard, application list/detail, tracking | Supabase session and `user_id`; application service loads children after an owner lookup | Resolve one voucher session and return only its application, paid voucher/payment and safe timeline. No user-wide query. |
| Wizard/autosave and submission APIs | `apiUser` plus service-only legacy workflow RPCs, expected revision | Session checked in the same database transaction as the exact application write; retain current form validation and revision rules. |
| Document upload/register/delete | Legacy session owner and derived user/application/document path; private bucket | Derive the path from the scoped voucher application; recheck session/revision at metadata commit and deletion. |
| Document download | Owner lookup and authenticated server stream | Voucher-scoped authorization before retrieval and again before returning bytes; never return the internal path to the browser. |
| Notifications and read state | Legacy `user_id` list/update | Read/update only explicit `applicant_notification_links` for this voucher access. |
| Voucher/payment history and receipt | Legacy owner-based lists; legacy PIN display/decryption still exists | One voucher's safe receipt/history DTO; no hash, ciphertext or ordinary receipt PIN. Retire old applicant credential redisplay at the reviewed cutover. |
| Profile and applicant identity | Legacy profile tied to Supabase user | Do not expose/edit a shared legacy profile from a voucher session. Use the scoped application's personal details. |
| Staff queues, review, private notes and downloads | Verified Supabase staff session and database role | Preserve this separate boundary, staff actor derivation, private notes and existing staff RPCs. |
| Public purchase/login routes | Existing email/password journey | Remain unchanged while rollout is disabled; guest checkout/claim are Phase B. No partial public cutover. |

The wizard, autosave, file validation, submission, tracking, review and notes already exist and are reused. This migration adds database-scoped adapters around their existing workflow engines rather than duplicating them.

## Exact changes

Nine new service-only RPCs:

| RPC | Scope and result |
| --- | --- |
| `load_voucher_portal(token_hash, page)` | Whitelisted voucher, payment snapshot, product, one application, education/experience/answers, document metadata, history and linked notifications. No credentials, staff notes, legacy user identity or storage path. |
| `redeem_portal_voucher(token_hash, job_id)` | Existing eligibility/redemption engine; replay for the same voucher/job returns its existing application. No second entitlement from cancellation/refund. |
| `save_portal_application(token_hash, application_id, revision, data)` | Exact session application, draft-only, optimistic revision; delegates to existing transactional autosave. |
| `submit_portal_application(token_hash, application_id, revision, declaration)` | Exact application and existing final checks; preserves submission retry behavior and one new principal-attributed submission event. |
| `portal_upload_context(token_hash, application_id, revision, document_id)` | Draft/revision check and server-only storage path derived from scope. No caller-supplied owner/path. |
| `register_portal_document(...)` | Rechecks session/application/revision after upload, validates metadata, derives path and requires an existing private object. |
| `remove_portal_document(...)` | Scoped draft-only metadata removal with revision; returns path to the server for storage cleanup. |
| `authorize_portal_document(token_hash, application_id, document_id)` | Exact application/document; returns private path/name/MIME to the trusted streaming server only. |
| `read_portal_notification(token_hash, notification_id)` | Requires a link to this voucher; preserves the first read timestamp on retries. |

One internal helper validates the session and holds payment, voucher, access, principal and session locks through the operation. It is not directly executable by `service_role`, `anon` or `authenticated`. The definer RPCs invoke it as their owner. Hashes are bearer-equivalent server material and must never be logged or accepted as a browser-supplied ownership assertion.

One notification INSERT trigger links future messages with an exact `/dashboard/applications/<uuid>` target to the matching application's voucher access, only when notification ownership matches. It creates no notification itself. Existing and ambiguous user-wide messages are **not backfilled or guessed**. Generic old voucher-ready/application-started messages therefore remain outside the new portal unless a later separately reviewed operation can establish their exact scope. Future submission and staff-review messages with an exact target are linked automatically. No staff note is copied into this path.

`resolve_voucher_session(text)` keeps its signature, owner, ACL and checks. Only its access-row lock changes from `FOR UPDATE` to `FOR NO KEY UPDATE`. This still conflicts with access/session authorization updates and competing resolutions, while allowing notification foreign-key `KEY SHARE` locks. Without this change, a staff review holding the application row and an applicant operation holding the access row could wait on one another. Payment `FOR SHARE` is acquired before the voucher lock, consistent with fulfillment's payment-before-voucher order; this prevents a refund from racing past the authorization check for a write. Future refund/reset operations must preserve the documented lock order.

There are no new tables, ownership-column changes, RLS replacements, grants on private tables, destructive DDL, backfills or business-row mutations at migration time. Existing `user_id NOT NULL`, XOR ownership constraints, voucher/application/payment foreign keys, service snapshots and all existing workflow RPCs stay intact. Applicant-attributed audit events added by the new operations contain identifiers and empty metadata, never PINs, tokens, document contents, note bodies or form payloads. Existing legacy engine audit/history entries remain; they are not rewritten.

## Compatibility and security limits

This is deliberately the legacy-owner bridge for already-issued vouchers. The scope is the new voucher session/principal, but the existing workflow engine still needs the immutable legacy `user_id`. Two vouchers sharing a legacy owner or email remain separate portal scopes. Guest-owned business rows remain impossible under the 0008 `NOT NULL` constraints. Phase B must explicitly activate and support that ownership form in a reviewed migration; this migration does not claim that guest checkout works.

Existing legacy account RLS and routes remain available exactly as before while rollout is disabled. This is not a global applicant authorization cutover. The later cutover must retire the public applicant account flow and legacy PIN redisplay without changing staff authentication or historical records.

- All new callable operations require `service_role`; `PUBLIC`, `anon` and `authenticated` execution is revoked, including named Supabase default grants. All definer functions use an empty `search_path` and qualified objects.
- Every operation validates its session in the transaction. No caller-supplied owner/principal is trusted. Foreign application, document and notification identifiers fail even when they belong to the same legacy user.
- Revocation, suspension, principal disable, credential-version mismatch and idle/absolute expiry fail closed. Resolution refreshes activity without extending the immutable 30-day maximum.
- An unused voucher may authenticate, but only a successful paid, unused, unexpired voucher can redeem an eligible managed opportunity. Existing redemption rules still apply.
- A used voucher's ordinary expiry does not block its application's tracking. Cancelled/refunded existing entitlements retain scoped reading unless access is revoked; they do not permit new redemption or application edits through these operations. An idempotent redemption retry may return the already-existing application; it creates nothing.
- The server adapter must retain existing Zod form validation, strict request shapes, same-origin protection, body/size limits, rate limits and the Secure/HttpOnly/SameSite cookie boundary. SQL does not validate file magic bytes: retain the existing PDF/PNG/JPEG inspection before upload.
- Storage writes and SQL are not one transaction. Use a random document ID, no upsert, revision recheck on registration, safe orphan cleanup and session revalidation before streaming downloaded bytes. No browser-supplied storage path or long-lived signed URL.
- Portal UI/API hookup, browser tests, guest purchase/claim, contact recovery, applicant responses/withdrawal and employer matching remain separate work. Rollout stays disabled.

## Local validation

Run `node scripts/verify-voucher-auth-expansion-local.mts --portal-stage`. The harness executes unchanged migrations 0001-0009 in disposable embedded PostgreSQL, then the exact proposed 0010, with mocked Supabase auth/storage schemas. It loads no environment file and contacts no hosted database or Paystack endpoint. Machine-readable results are written to `test-results/voucher-portal-0010-local.json` with the migration SHA-256.

The exact proposed SQL passed eight local integration check groups: transactional rollback and preservation; function permissions; voucher scope/redemption; application/document isolation; submission/staff/notification/audit behavior; voucher lifecycle; session invalidation/expiry/ownership consistency; and safe rerun failure. The read-only catalog query also passed locally with all 12 function entries, 14 owner-column entries, eight private tables and the new notification trigger. The report SHA-256 matches the current migration file.

TypeScript, lint, all 102 unit tests across 18 files and the webpack production build passed. Evidence: `test-results/voucher-portal-{typecheck,lint,tests,build}.log`, `test-results/voucher-portal-local.log`, and the local JSON report/catalog. No new applicant routes were enabled for these checks. Hosted 0010 execution, multi-connection races and browser integration are **pending**, not reported as passed.

Embedded PostgreSQL uses one connection. It cannot prove actual multi-connection lock races or hosted Supabase Storage/HTTP behavior. Those remain hosted verification work after manual application. Local test fixtures are discarded with the in-memory database; no existing hosted record is changed.

## Manual Supabase step — only after review

1. Review this document and the complete [0010 SQL](../supabase/migrations/202610030010_voucher_scoped_portal.sql), including the resolver lock change and notification-link trigger.
2. In the existing CruiseApply Supabase project, open SQL Editor as `postgres`.
3. Paste and run the **entire contents** of `202610030010_voucher_scoped_portal.sql` once, from `begin;` through `commit;`. Do not rerun migrations 0001-0009, change existing test records, enable applicant auth or enable Paystack Live Mode.
4. Run [verify-0010-readonly.sql](../supabase/configuration/verify-0010-readonly.sql) as `postgres` and save the complete `verification_0010` result to `supabase/configuration/verification_0010.json`. It reads catalog definitions/permissions only, not credential values, and enables exact hosted comparison without granting browser catalog access.
5. Confirm success. Keep `APPLICANT_AUTH_ENABLED=false`. The next development step is hosted verification with disposable fixtures, followed by the disabled portal UI/API adapters.

Applying SQL is a genuine manual gate required by the owner's instruction to review each grouped database change before hosted application. No hosted application has been attempted automatically.

## Hosted verification after application

Compare exact function definitions, owners, ACLs, empty search paths and trigger binding; verify existing RLS/table grants and legacy data digests remain unchanged. Exercise anonymous/applicant RPC denial and service access with disposable, clearly labelled fixtures. Test two vouchers with one owner/contact, a second owner, foreign IDs, document metadata/storage isolation, expiry, revocation, version rotation and first-read idempotence. Test simultaneous duplicate redemptions/submissions, stale saves, upload/submission races, logout/revocation against writes, and staff review/notification insertion against portal requests. Confirm one application/submission event, safe audits and no staff-note disclosure. Remove all temporary fixtures. Do not redeem or mutate the original paid voucher/application for these tests.

Browser verification follows the disabled adapter implementation in an isolated test environment: login, same-origin/cookie boundaries, dashboard, wizard, private streaming, history/receipt without PINs, notifications and logout. Production rollout remains disabled until the complete revised journey and explicit release approval.

## Rollback

The migration is one transaction. A statement failure rolls back all function/trigger/grant changes, including restoration of the prior resolver body; an injected late failure is covered locally. If SQL Editor reports an aborted transaction, run `rollback;`, retain the error and do not rerun earlier migrations.

After a successful commit, there is no automatic down-migration. Keep rollout disabled and investigate before changing schema. A reviewed rollback could remove only the new trigger/RPCs/helper and restore the exact 0009 resolver; it must account for any later operations/links and must not delete historical data or undo applied 0008/0009. Existing public/staff routes do not depend on the new operations yet.

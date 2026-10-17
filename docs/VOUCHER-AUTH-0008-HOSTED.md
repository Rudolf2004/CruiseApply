# Migration 0008: fully hosted-verified

Verdict: **PASS for the complete 0008 hosted catalog**, together with the preceding read-only hosted API checks. The supplied export was reviewed in full against the local catalog produced by unchanged migrations 0001-0008. Do not edit or rerun 0008. No applicant-auth cutover has occurred.

The actual export is [supabase/configuration/verification_0008.json](../supabase/configuration/verification_0008.json), not the repository-root path in the message. SHA-256: `70b6acba55d12e38180801d27da3e9fc4d978cd977e2e68fe9442cf3a1c9773e`. Hosted engine: PostgreSQL 17.6. Comparison: [compare-voucher-auth-0008-catalog.mts](../scripts/compare-voucher-auth-0008-catalog.mts); results: test-results/voucher-auth-0008-catalog-comparison.json.

Exact matches after normalizing CRLF/outer whitespace and catalog ordering: eight private tables and their complete role privilege matrices; 81 columns/defaults/nullability entries; 208 constraints; 94 indexes with readiness/validity; 20 triggers; 21 existing RLS policies; eight guard definitions and permissions. All eight new table counts are zero. PostgreSQL 18's separate NOT NULL catalog constraints were excluded from comparison with PostgreSQL 17; column NOT NULL flags were compared directly. No SQL bodies or string-literal whitespace were normalized away.

All 17 existing function bodies match. Ten EXECUTE flags across six legacy functions differ from the local fixture: hosted anon/authenticated/service_role can execute handle_new_user and audit_change; hosted service_role can execute is_admin, protect_payment_snapshot, protect_payment_quote and guard_managed_application. Five are trigger functions, which cannot be invoked as ordinary functions; is_admin only tests the existing auth.uid() profile role and grants no new role. These are not 0008 functions and 0008 does not alter their ACLs. Named-role defaults can explain such grants, but no pre-0008 hosted ACL snapshot exists to establish their historical origin. These differences are explicitly recorded, not silently ignored or represented as an exact legacy grant match. The existing service-only business RPC boundaries match; all new guards deny direct execution to browser/service roles.

Read-only hosted API verification passed on 2026-10-02:

- All eight new private tables exist, are empty, and reject anonymous SELECT with PostgreSQL permission error 42501.
- New applicant ownership, checkout and applicant actor columns are exposed to the service-role API.
- The original successful payment remains 15000/GHS; the other known payment remains pending without a voucher.
- Exactly one used voucher CRV-2026-00000003 belongs to the paid transaction and original owner, with one submitted APP-2026-00000001 and one Voucher ready notification.
- Checked legacy rows retain their original user ownership and null applicant_id. Before/after digests match across this verification run.
- The original owner's Supabase Auth user still exists.

Script: [verify-voucher-auth-expansion-hosted.mts](../scripts/verify-voucher-auth-expansion-hosted.mts). Evidence: test-results/voucher-auth-0008-hosted-readonly.json. The script makes no writes, RPC calls, sign-ins or Paystack calls and does not print credentials or record bodies.

## Completed manual confirmation

The supplied catalog export completes the previously pending catalog inspection. REST access alone could not establish these facts. An empty response alone would not prove RLS; the anonymous checks above specifically received permission denial.

The owner ran [verify-0008-readonly.sql](../supabase/configuration/verify-0008-readonly.sql) as postgres and supplied its complete result. The procedure below records that completed step; no rerun is required:

1. Paste the entire file, including BEGIN TRANSACTION READ ONLY and COMMIT.
2. Run it once.
3. Export/copy the verification_0008 JSON result and provide it for review. The report contains schema definitions and privileges, not tokens, PINs or applicant row data.

Expected: eight private tables, all RLS enabled; zero new-table counts; no anon/authenticated/PUBLIC table grants; service-role SELECT/INSERT/UPDATE/DELETE only; eight guards without browser/service direct execution; valid indexes and constraints; legacy user_id NOT NULL with nullable applicant_id; non-cascading new FKs; unchanged existing RLS/RPC definitions. Compare the returned definitions with migrations 0001-0008 before declaring completion.

No pre-0008 complete hosted row snapshot was captured by this check. Historical preservation is supported by documented known states and the migration's locally tested no-business-DML behavior, not an invented before-migration hash comparison. Interactive authentication behavior has not been retested: a fresh sign-in would create session/audit state and is outside this strictly read-only check. Existing authentication source and policies have not been changed by this work.

## Next stage after confirmation

Prepare a separately reviewed service-only voucher session operations migration first: explicit legacy access binding after credential proof, version-checked session issuance/resolution, 7-day idle refresh capped by immutable 30-day expiry, current-session logout and scoped revocation. No browser role RPC access, email ownership lookup, guest-owner activation, automatic backfill or staff-auth changes.

The subsequent protected initial-claim and verified PIN-rotation operations must lock voucher access and delivery/challenge state, enforce single-use proofs and credential versions, return a new PIN only to the winning request, revoke every scoped session on rotation, and avoid persisting plaintext credentials. They require their own SQL/application review and tests; 0008 alone does not enable these operations.

The staged test plan covers service-only execution, forged actor/scope denial, same-email cross-voucher isolation, concurrent initial claims, reset/session races, stale credential versions, idle/absolute expiry, logout/revocation, used/expired/cancelled/refunded lifecycle behavior, legacy RPC compatibility and fixture cleanup. The first scoped session operation stage, [0009](VOUCHER-SESSION-0009-HOSTED.md), is now applied and fully hosted-verified. The [server PIN/cookie boundary](APPLICANT-AUTH-SERVER-BOUNDARY.md) remains disabled. Initial claim/reset, guest checkout and auth cutover remain subsequent stages. Do not apply a new migration automatically.

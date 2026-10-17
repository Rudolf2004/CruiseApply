# Migration 0009 hosted verification

**0009 fully hosted-verified: PASS.** Hosted behavioral tests passed on 2026-10-02; complete installed-function catalog comparison passed on 2026-10-03. The owner applied 0009; no migration was applied by the verifier, no correction was necessary, and no new migration was created.

The entire [verification_0009.json](../supabase/configuration/verification_0009.json) export matches the local catalog from the exact 0009 SQL: all four signatures, full function bodies, SECURITY DEFINER, empty search_path, postgres ownership, complete ACL/grantability entries, and anon/authenticated/service-role execution permissions. All eight private-table RLS/read-permission entries match. Only ordering, CRLF line endings and outer whitespace were normalized. Source SHA-256: `9e8da34151d2e358190bf90c09ee59816f31b4d30bb17aa4000cb27e6e326cab`. Reproducible comparison: [compare-voucher-session-catalog.mts](../scripts/compare-voucher-session-catalog.mts); evidence: test-results/voucher-session-0009-catalog-comparison.json.

Evidence: test-results/voucher-session-0009-hosted.json and its execution log. Runner: [verify-voucher-sessions-hosted.mts](../scripts/verify-voucher-sessions-hosted.mts). The completed run returned exit code 0 and cleanupComplete=true.

## Executed against hosted Supabase

| Check | Result |
| --- | --- |
| Four RPCs, eight private tables | Anonymous, authenticated applicant and authenticated admin clients denied direct access with 42501; service-role calls succeed |
| PIN proof boundary | Real salted scrypt derivation verified in the test server process; wrong hash, stale version, malformed token digest and unknown serial rejected |
| First-login concurrency | Six concurrent successful logins create one access/principal binding, one binding audit and six distinct sessions |
| Token collision concurrency | Six calls with one token digest yield one session and five uniqueness rejections |
| Scope isolation | Two vouchers sharing the same legacy owner and email have distinct principals and payment/application scopes; no user-wide result or credential fields |
| Session lifetime | Exactly 168-hour initial idle and 720-hour absolute lifetime; expired idle/absolute fixtures denied; near-limit refresh capped at original absolute expiry |
| Refresh concurrency | Six concurrent refreshes preserve creation/absolute expiry and advance valid activity |
| Logout concurrency | Six logouts racing six refreshes leave the session revoked, create one logout audit and preserve other sessions |
| Credential race | Fixture credential hash/version update racing login/refresh invalidates old-version sessions; current hash never falls back to the old legacy hash |
| Lifecycle | Used vouchers with passed validity retain tracking; expired unused vouchers have no application; cancelled/refunded vouchers retain scoped access unless explicitly disabled/revoked. No redemption is performed |
| Suspension/revocation | Suspended access and disabled principals deny login/resolution; concurrent access revocation defeats subsequent resolution; logout remains possible |
| Audit safety | Session/binding events have scoped applicant actors and identifier-only metadata; no plaintext PINs, hashes or raw session tokens appear in audit rows |
| Legacy staff behavior | Existing staff review and internal-note RPCs work on a temporary application; applicant cannot read notes and authenticated staff can |

Concurrency tests use independent hosted API requests, not the previous single-connection local engine. They exercise races but do not exhaust every possible scheduler interleaving. Credential rotation was a privileged update of an isolated fixture; this does not claim that a production PIN-reset operation exists or that atomic reset/session-revocation has been implemented.

## Preservation and cleanup

Temporary synthetic database payments used provider `integration_fixture`. No Paystack initialization, verification or webhook call occurred. No actual payment/voucher/application was converted, adopted or updated.

Before/after full-row digests match across 18 tables: profiles, payments, vouchers, applications, notifications, application_status_history, application_review_commands, admin_notes, application_matches, audit_logs and all eight 0008 tables. The database had 3 payments, 2 vouchers and 1 application before the run and the same unchanged rows afterward. All eight 0008 tables started and ended empty.

Temporary sessions, access bindings, principals, synthetic payments/vouchers, application, review records, notes, notifications, fixture audit entries and two temporary Auth users were removed. Original project audit rows were preserved. Supabase-managed authentication/platform logs for the temporary sign-ins are outside application-table cleanup and were not modified.

No applicant routes, cookie behavior, staff authentication code or auth cutover was changed. Browser-role denial was tested through anonymous/authenticated API clients using the same Supabase JWT roles as browser requests. There is no new applicant login browser flow to test yet.

The initial verifier had a baseline ordering issue for application_review_commands (request_id rather than id); it was corrected before any fixture creation. This was a test-runner issue, not a migration defect. The final complete run passed. Targeted lint and the local PostgreSQL regression suite also passed; the supplied manual catalog query executes successfully locally. Application source did not change, so no production-build result is claimed for this SQL-only verification task.

## Completed manual read-only catalog step

The configured Supabase REST/service keys do not expose pg_proc. The owner supplied the complete SQL Editor export, which has now been compared successfully. The procedure below records the completed step; no rerun is required.

1. In the existing Supabase SQL Editor, select `postgres`.
2. Run the entire [verify-0009-readonly.sql](../supabase/configuration/verify-0009-readonly.sql), including BEGIN TRANSACTION READ ONLY and COMMIT. This is not a migration and writes nothing.
3. Export the `verification_0009` JSON result to `supabase/configuration/verification_0009.json` and provide the file for review.

Expected: all four functions exist, are SECURITY DEFINER with empty search_path, deny EXECUTE to PUBLIC/anon/authenticated, and permit service_role EXECUTE; function bodies match applied 0009. Eight private tables retain RLS and deny anonymous/authenticated SELECT. The report contains schema definitions and grants, not credential values or applicant records. No browser-only action is required at this stage.

## Next stage

The [server-only applicant authentication boundary](APPLICANT-AUTH-SERVER-BOUNDARY.md) is now prepared behind a disabled rollout switch: input validation, generic failure responses, serial/trusted-client throttling, supported scrypt verification, random token hashing, independent Secure/HttpOnly/SameSite cookies, scope resolution and POST logout with origin protection. Existing public authentication routes and staff Supabase authentication remain unchanged.

Do not enable applicant login until every applicant loader/write/document/notification operation uses voucher scope and server-session authorization. Guest checkout, one-time PIN claim and verified email-based reset/rotation remain separately reviewed stages. Reset must revoke all scoped sessions and retire legacy credential acceptance; it must never retrieve an old PIN. No SMS/WhatsApp implementation is planned. No new Paystack transaction or Live Mode is needed for the next stage.

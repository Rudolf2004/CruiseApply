# Migration 0009: scoped voucher session operations (applied)

> Current status (2026-10-03): 0009 is applied and fully hosted-verified. Behavioral, authorization, concurrency, preservation and exact installed-function catalog checks passed. See [hosted results](VOUCHER-SESSION-0009-HOSTED.md) and the [disabled server boundary](APPLICANT-AUTH-SERVER-BOUNDARY.md). The original pre-application review below is historical; do not rerun 0009.

SQL: [202610020009_voucher_session_operations.sql](../supabase/migrations/202610020009_voucher_session_operations.sql).

0008 and 0009 are applied and their complete supplied hosted catalogs are verified. This is the session-operation stage, not a complete applicant-auth release. It adds four new functions with service-role-only EXECUTE and an empty search_path. It changes no existing function, table constraint, RLS policy, browser grant, route, cookie or business record during migration. The existing user_id NOT NULL constraints remain.

## Operations

| Function | Server contract and database behavior |
| --- | --- |
| get_voucher_login_material(serial) | Returns only voucher ID, authoritative salted PIN hash and credential version to the trusted server. No encrypted PIN, contact email or staff information. Missing, pending-delivery, suspended, revoked or disabled access gives no rows. Current credentials never fall back to the legacy hash. |
| open_verified_voucher_session(serial, verified hash, expected version, token digest) | Called only after successful server-side PIN verification. Locks the voucher and access, rechecks the exact hash/version and access/principal state, then creates one session. A legacy voucher without a binding gets one principal/access binding explicitly on successful login; the voucher/payment/application owner is not changed. |
| resolve_voucher_session(token digest) | Locks access, principal and session, checks version/revocation/idle/absolute expiry and refreshes activity without extending absolute expiry. Returns only that voucher's IDs for access, principal, payment and application plus session expiry. It does not return a user-wide profile or dataset. |
| logout_voucher_session(token digest) | Revokes only that session, even when already expired/suspended/stale. Repeated logout is a no-op and does not create duplicate logout audit events. |

Only new mapping/session rows and identifier-only audit events are written when operations are later invoked. No backfill runs on migration application. The first successful explicit legacy login creates a mapping; failed proof or token collision rolls back the mapping and audit together. Two valid independent logins may create separate sessions, but must share the one voucher principal. Login is not initial credential claim: it never generates or displays a PIN.

## Required server boundary before enabling routes

1. Accept serial/PIN only in a HTTPS POST body. Apply trusted-client and serial rate limits before credential lookup/scrypt; use generic failure responses and dummy derivation for missing serials. Never log request bodies, PINs, credential hashes, raw cookies or capability digests.
2. Fetch login material with a server-only service client. Verify the PIN using the supported salted scrypt verifier and timing-safe comparison. Reject unsupported encodings. Never accept a verified hash, credential version, applicant ID or staff actor from the browser.
3. Generate 32 CSPRNG bytes for a fresh session token. Pass only its SHA-256 digest, the server-read hash and expected version to the opening RPC. The SQL compares a previously verified hash under lock; it does not run scrypt or independently prove the submitted PIN. A compromised service-role key remains a privileged compromise.
4. Set an independent applicant cookie after commit: Secure, HttpOnly, SameSite=Lax, Path=/, no Domain, preferably a __Host- name. Use Cache-Control: no-store on auth responses. Clear the cookie after logout. Do not use localStorage, URLs or analytics. Staff Supabase cookies remain separate. Local browser testing will require HTTPS for the Secure cookie.
5. Hash the cookie server-side and resolve it for every protected request. Cookie expiry can refresh to min(activity+7 days, immutable creation+30 days). Cookie presence alone grants nothing. Database lifetime uses 168 and 720 hours.
6. Authorize by returned voucher/application IDs, never user_id/email alone. The resolver is not a generic service-role data proxy. Do not return private rows directly; future loaders require explicit safe fields and voucher predicates. Staff notes are excluded. State-changing application operations must recheck the session under database locks in their own transaction, rather than trusting an earlier resolver result across a reset/revocation race.
7. Require same-origin/CSRF protections for state-changing routes. Logout must POST and always clear the client cookie. Browser roles retain no direct access to private tables or these functions.

No route calls these functions in this stage. This prevents a partial auth cutover with legacy user-wide loaders still active.

## Lifecycle and isolation

- Unused vouchers may authenticate; only valid unexpired vouchers may redeem through a separate eligibility-checked operation.
- Used vouchers keep access to their existing application after the normal voucher expiry.
- Expired unused vouchers may view their limited scope but cannot initiate an application.
- Cancelled/refunded vouchers grant no new redemption or paid entitlement. Their existing application may remain readable/trackable unless principal/access is explicitly disabled, suspended or revoked. This migration grants no editing/submission rights for these states.
- Voucher status is not session authorization. Session/access/principal validity and credential version are checked independently. Previously verified payment lineage is required for login binding.
- Multiple vouchers belonging to the same legacy account or sharing an email receive distinct principals. Neither material lookup nor session resolution uses email to select ownership.

## Concurrency and recovery boundary

Opening uses voucher -> access -> principal -> new session locks. Resolve/logout use access -> principal (when needed) -> session locks. Future binding/claim/reset operations must preserve a compatible order; privileged administration that disables a principal must not lock it and then wait for access in the reverse order. The database UNIQUE voucher/access/principal constraints remain the final ownership guard.

Resolution checks the credential version while holding the access lock; a later rotation's version increment invalidates every old-version session. The eventual verified reset RPC must also explicitly revoke all those session rows atomically. 0009 does not implement PIN reset, a recovery email sender, initial PIN claim, or guest checkout. There is no PIN retrieval RPC and no SMS/WhatsApp integration.

Reset cannot be safely enabled before the separate reviewed legacy-route/ciphertext retirement work. Existing legacy receipt/redeem routes still use their old credentials; do not activate a new reset that leaves those credentials usable. Contact proof must be voucher-specific, single-use, unexpired and bound to the current contact version. Initial claim must return a newly generated PIN only to the winning committed request; a lost result requires verified rotation. Neither operation may cache plaintext PINs in idempotency records.

## Local verification

Run `node scripts/verify-voucher-auth-expansion-local.mts --session-stage` using the existing temporary PGlite installation. It executes migrations and synthetic fixtures only in disposable local PostgreSQL; no environment credentials or hosted connections are read. Detailed results: test-results/voucher-auth-0009-local.json.

Local PostgreSQL checks passed for transactional rollback, no migration-time data/policy/old-function changes, browser-role RPC denial, exact hash/version binding, digest format, no legacy fallback after rotation, token collision rollback, one-voucher scope, same-owner isolation, repeated legacy adoption, expiry arithmetic, idle/absolute rejection, capped refresh, logout idempotency, suspension/revocation, disabled principals and safe audit attribution. The permission tests include named-role default EXECUTE grants like those observed in the hosted catalog. Targeted ESLint passed for the verification scripts. A test failure caused by comparing two Date objects by identity was corrected in the harness; no SQL relaxation was made.

Limits: one embedded PostgreSQL connection cannot prove true multi-connection locking behavior. Supabase auth/storage are local mocks. No HTTP cookie, browser, scrypt integration, recovery delivery or hosted 0009 behavior is claimed as tested. No Next.js runtime source changed, so a production build is not evidence for these SQL operations.

## Original application procedure (completed; do not rerun)

The owner reviewed the explicit legacy-login binding and server trust boundary, then applied the exact SQL using this procedure:

1. Open the existing Supabase project's SQL Editor as postgres.
2. Paste the entire 202610020009_voucher_session_operations.sql, including BEGIN/COMMIT, and run once. Do not rerun 0001-0008.
3. Confirm success. If it errors, stop and report the error; ROLLBACK if the connection remains aborted.
4. Keep the current auth flow unchanged until the staged server implementation and later reviewed activation work are complete.

After manual application, verify function definitions and all EXECUTE grants, then run authorized temporary-fixture hosted tests: browser denial; simultaneous legacy logins creating one binding; credential-change versus opening/resolution; logout versus refresh; no duplicate logout audit; expired/disabled/revoked denial; same-email cross-voucher isolation; and no legacy-record mutation. Clean fixtures in FK-safe order. Original paid E2E records must not be adopted or changed merely to make tests pass. No Paystack transaction is required.

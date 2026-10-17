# Applicant authentication server boundary: prepared, rollout disabled

Migration 0009 is fully hosted-verified, including the complete supplied function catalog. This stage adds server code only; it applies no migration, changes no hosted records and makes no Paystack call. `APPLICANT_AUTH_ENABLED` is disabled by default and remains disabled in the configured environment. The example environment explicitly sets it to false.

## Prepared endpoints

All three endpoints are POST-only, dynamic Node.js handlers under `/api/applicant-auth/`:

- `login`: bounded JSON `{serial, pin}`, throttling, authoritative credential lookup, actual salted scrypt verification, locked proof/version recheck through 0009, then a fresh random applicant-session cookie.
- `session`: resolves the applicant cookie server-side, refreshes database activity within the immutable absolute limit, and renews the cookie expiry. Returns only `{authenticated:true}`; scope IDs remain server-side.
- `logout`: revokes the current session through 0009, then clears only the applicant cookie. On a database failure it returns 503 and keeps the cookie so revocation can be retried; it never reports successful logout without confirmation.

Disabled requests return 404 before database access or cookie changes. The Supabase session-refresh proxy bypasses these paths so applicant endpoints cannot create/refresh staff or legacy Auth cookies. Existing login/register pages, dashboard loaders, public navigation and staff guards are unchanged. These endpoints have no new UI links.

## Security behavior

- The flag is server-only and recognizes only the literal value `true`; no public configuration or browser parameter can enable it. Service functions enforce the flag too.
- Enabled requests require a configured HTTPS application origin and exact matching Origin header; cross-site Fetch Metadata is rejected. No insecure development cookie exception is present. JSON login payloads are limited to 2048 bytes and reject browser-supplied actor, hash, version and extra fields.
- Before credential lookup or scrypt, the existing atomic `consume_request_limit` RPC enforces 120 attempts/minute globally, 30 attempts/15 minutes per trusted-client key, and 8 attempts/15 minutes per normalized serial. Limiter failure denies the request. Successful attempts count too.
- Without configured proxy trust, all clients share the client limit. Arbitrary forwarding headers are ignored. Optional `APPLICANT_AUTH_TRUSTED_IP_HEADER` accepts only `cf-connecting-ip` or `x-real-ip`; it must be configured only after the deployment proxy overwrites that header and direct origin access is blocked. Missing/invalid trusted headers fail closed. IPs and serials are hashed in limit keys; hashes are pseudonymous, not a guarantee of anonymization. PINs never form limit keys.
- Supported credentials use the existing s1 scrypt verifier and timing-safe comparison. Unknown serials, malformed credentials and unsupported encodings perform one dummy scrypt derivation before generic denial. s2 is reserved in the schema but is not accepted by this server verifier. This equalizes KDF work, not total network timing.
- The browser supplies only serial/PIN. The server reads the authoritative hash/version and submits them to the locked opening RPC only after successful verification. Current credentials never fall back to the legacy hash. A changed credential/version under lock produces generic denial.
- Session tokens contain 32 CSPRNG bytes encoded as base64url. Only SHA-256 digests reach SQL. PINs, hashes and raw tokens are not logged, returned in JSON, placed in URLs, notifications, audit metadata, analytics or localStorage.
- The cookie is `__Host-cruiseapply_applicant`, Secure, HttpOnly, SameSite=Lax, Path=/, without Domain. Expiry is capped by both database idle and absolute expiry. Staff cookies are neither read as applicant credentials nor changed. Duplicate or malformed applicant cookies cannot resolve a scope.
- Responses use private/no-store caching, Vary: Cookie, no-referrer and nosniff. Raw database errors never reach callers. Invalid/expired sessions clear only the applicant cookie; infrastructure errors remain retryable.
- The resolver returns a validated voucher/payment/application scope to trusted server callers only. It is not permission to perform arbitrary service-role queries or user-wide joins. Future write operations must revalidate session/version under database locks in the same transaction as each write to close revocation races. Staff notes must never enter applicant payloads.

## Verification and release boundary

Completed on 2026-10-03:

- TypeScript, full ESLint and all 102 tests across 18 files passed.
- The Next.js webpack production build passed, including its TypeScript check.
- A separate local production server, using the unchanged disabled configuration, returned no-store 404 without Set-Cookie for all three POST endpoints. GET returned 405. The test server was stopped after verification. Evidence: test-results/applicant-auth-disabled-http.json; runner: scripts/verify-applicant-auth-disabled.mts.
- Complete 0009 catalog comparison passed, including checking that the local reference catalog corresponds to the SHA-256 of the actual migration SQL.

One new test exposed Next's recalculation of Expires when Max-Age is supplied. Active cookies now use the database expiry timestamp directly; logout still uses Max-Age=0. The full suite passed after that correction. No database security guarantee was relaxed.

The tests exercise enabled behavior only inside isolated Vitest configuration with mocked database RPCs and real scrypt. They do not enable a Next.js deployment or write hosted sessions. Tests cover disabled short-circuiting, origin/HTTPS enforcement, rate limits, spoofed headers, leading-zero PINs, missing/wrong/unsupported credentials, browser proof injection, cookie serialization/expiry/isolation, missing/duplicate cookies, locked proof failure and logout outages. The prior hosted 0009 tests independently covered actual database authorization, isolation and concurrency.

The supported cookie flags are tested through real NextResponse serialization. A live HTTPS browser login with hosted session issuance remains a later explicitly authorized integration step; it is not claimed as completed here. No reset, SMS, WhatsApp, recovery sender, guest checkout or one-time PIN-delivery flow is enabled.

Do not enable the flag yet. Before a separately approved rollout:

1. Complete voucher-scoped applicant loaders, mutations, private documents and notification access. Existing user-wide applicant APIs must not become reachable through a voucher session.
2. Review the guest purchase/initial claim and verified PIN rotation stages, including retiring legacy credential display/acceptance and atomically revoking all scoped sessions on reset.
3. Confirm the HTTPS origin and proxy trust configuration, then run an explicitly authorized temporary-fixture browser/session integration test. Keep staff Supabase authentication separate.
4. Review the public Buy Voucher -> Serial/PIN Login -> Application -> Tracking UX and explicitly approve activation.

There is no new SQL/manual migration step for this server boundary.

The next Phase A database dependency is now prepared separately: [migration 0010 and review instructions](VOUCHER-SCOPED-PORTAL-MIGRATION.md). It adds session-scoped portal operations without enabling this boundary or changing the public applicant journey. The [current project tracker](IMPLEMENTATION.md) records the remaining Phase A-L work and manual gates.

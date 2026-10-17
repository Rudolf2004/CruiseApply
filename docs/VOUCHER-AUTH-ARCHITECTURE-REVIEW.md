# Voucher-based applicant authentication: impact analysis and proposed plan

Status: architecture direction approved; 0008 and 0009 are fully hosted-verified including exact catalog comparison. The [server PIN/cookie boundary](APPLICANT-AUTH-SERVER-BOUNDARY.md) is prepared with rollout disabled; applicant-auth cutover has not started. The approved 7-day idle / 30-day absolute session limits, post-redemption tracking access and hash-only PIN rotation supersede the earlier proposals below. See [migration 0008 and approved lifecycle design](VOUCHER-AUTH-EXPANSION-MIGRATION.md). This document retains the original analysis for context.

Initial review status: review only. No implementation, SQL migration, hosted data, credentials or Paystack transaction was changed during this analysis. Applied migrations 0001-0007 remain the historical baseline. This proposal supersedes the instruction to perform another checkout under the existing account-based applicant flow.

## Recommendation

Use two independent authentication systems:

- Applicants: server-side serial/PIN verification followed by an opaque, revocable applicant session scoped to one voucher and its application.
- Staff: existing Supabase Auth email/password sessions plus database admin/super_admin authorization.

Do not create hidden Supabase Auth users, synthetic email addresses, or Supabase passwords derived from voucher PINs. Do not issue a Supabase staff/user JWT merely because a voucher PIN was verified. A contact email is still collected for Paystack and communications, but is not an applicant account or login credential.

A voucher login should not inherit every record belonging to a legacy Supabase user. One voucher grants access to its own payment, application, documents and explicitly associated notifications. Combining multiple vouchers into one portal identity is outside this initial change and must never happen merely because email addresses match.

## Current dependencies found in source

| Area | Current assumption | Required change |
| --- | --- | --- |
| Identity | `profiles.id` is an FK to `auth.users`; `is_admin()` uses `auth.uid()` | Keep this staff/legacy structure intact; add independent applicant principals |
| Session guards | `requireUser()` and `apiUser()` require `db.auth.getUser()` and a profile | Separate staff guards from voucher-session guards; never infer staff rights from applicant cookies |
| Public purchase | `/buy-voucher`, quote and initialization routes require an authenticated applicant | Public guest purchase with a restricted checkout capability and contact details |
| Pricing | `payment_quotes.user_id` owns the quote; `create_payment_from_quote()` derives email from `auth.users` | Guest quote/checkout RPCs derive immutable ownership and contact snapshots from a server-validated checkout context |
| Payment callback | Calls `apiUser()` and filters verification by the authenticated user's ID | Checkout-capability authorization for success display; no applicant password login dependency |
| Fulfillment | `fulfill_verified_payment()` inserts vouchers and notifications using `payment.user_id` | Preserve verification/row locks/idempotency; extend only ownership routing for new independent principals |
| Voucher usage | PIN verification first filters by existing `user_id`; redemption requires that user | PIN login first establishes a voucher-scoped session; redemption then uses that scope |
| Credential display | `/dashboard/vouchers/[id]` decrypts and displays the PIN in the printable receipt | Separate deliberate secure credential delivery from ordinary receipts; receipts must no longer reveal reusable PINs |
| Applications | Loader, autosave, submission and recovery use `p_user_id`/`user_id` | Session-derived voucher/application ownership in database operations |
| Documents | Metadata has `user_id`; SQL validates storage paths as `user_id/application_id/document_id` | New principal-based paths for new uploads; retain existing paths and authorize through the owned application |
| Notifications | Reads and mark-read operations filter only by `user_id` | Explicit voucher scope, including legacy notification links where attribution is unambiguous |
| Applicant pages | Dashboard/layout, profile, history, receipt, documents and tracking require Supabase Auth | Read through the applicant-session boundary and safe scoped data transfer objects |
| Staff candidate page | Resolves application `user_id`, then calls the applicant loader | Dedicated staff-authorized application loader supporting both ownership forms |
| Staff decisions | `review_application()` inserts notifications for `application.user_id` | Route new notifications to the correct applicant principal/voucher; retain staff actor, revision and retry guarantees |
| Staff notes | Staff session, `profiles` actor and staff-only RLS | Preserve unchanged access rules; never include notes in applicant RPC payloads |
| Public UX | Header, auth form and related links promote `/register`; logout is shared | Applicant Login and Buy Voucher routes; separate staff login/logout/recovery |
| Audit | Applicant history/audit actors currently reference `profiles` | Add explicit applicant-principal attribution without pretending the applicant is staff |
| Tests | Fixtures usually create Supabase Auth applicants | New guest/voucher fixtures plus regression coverage for unchanged legacy records |

Reviewed sources include migrations 0001-0007, `src/lib/auth.ts`, `src/lib/http.ts`, `src/lib/voucher-credentials.ts`, payment/voucher/application/notification services, protected route callers and the voucher receipt page. This is a source-level architecture review; it did not query or change live policy catalogs or business records.

## Proposed schema: new tables

Names below are proposed contracts, not applied SQL.

| Table | Required fields and constraints | Purpose |
| --- | --- | --- |
| `applicant_principals` | `id uuid PK`, display/contact fields, `created_at`, `disabled_at`; no FK to `auth.users`, no role/password columns | Independent identity for one voucher purchase/access scope |
| `guest_checkouts` | `id uuid PK`, unique hashed random capability, `applicant_id FK`, fixed contact email/name/phone and country, creation/expiry/revocation timestamps | Authorize quotes, initialization, status and credential delivery before login; never authorize applications or staff APIs |
| `voucher_access` | `id uuid PK`, `voucher_id UNIQUE FK`, `applicant_id FK`, nullable `legacy_user_id FK profiles` for provenance, `credential_version`, `revoked_at`, timestamps | Explicit ownership bridge for legacy and new vouchers; unique voucher binding; legacy owner is not a broad access grant |
| `applicant_sessions` | `id uuid PK`, unique token digest, `voucher_access_id FK`, credential version, creation/last-activity/idle/absolute expiry/revocation timestamps | Opaque applicant sessions, invalidated on logout, revocation or PIN rotation |
| `voucher_credential_deliveries` | unique voucher binding, checkout binding, claim token digest if separately needed, expiry, first-delivery/closure timestamps | Narrow authorization and replay-safe delivery state; never plaintext PIN storage |
| `applicant_notification_links` | composite unique `(notification_id, voucher_access_id)`, foreign keys | Explicit scope for new and safely attributable legacy notifications |

Session and checkout tokens are independently generated with 32 cryptographically random bytes. Store only token digests. These tables have RLS enabled and no anon/authenticated direct access. Service-only functions are the public-server entry points. Delete policies are not introduced for browser roles.

## Proposed changes to existing tables

For `payment_quotes`, `payments`, `vouchers`, `applicants`, `applications`, `application_documents` and `notifications`:

1. Add nullable `applicant_id uuid REFERENCES applicant_principals(id)`.
2. Make existing `user_id` nullable, retaining its existing FK for legacy rows.
3. Add an exactly-one-owner check: `(user_id IS NOT NULL) <> (applicant_id IS NOT NULL)`.
4. Add indexes for new principal lookups; add a unique non-null applicant owner for `applicants`, matching the existing unique legacy `user_id` intent.
5. Preserve old rows with their original `user_id` and NULL `applicant_id`. Do not backfill or reassign financial/application ownership.

Also:

- Add nullable `guest_checkout_id` FKs to new quotes/payments and enforce consistent checkout/principal ownership in SQL; quote-to-payment unique linkage and frozen pricing remain.
- Add nullable `actor_applicant_id` FKs to `application_status_history` and `audit_logs`, with no row allowed to claim both a staff/legacy profile actor and an independent applicant actor. System events can retain no actor.
- Keep existing staff actor columns/FKs in notes and review commands.
- Extend the managed-application identity guard to freeze new `applicant_id` exactly as it freezes `user_id`, job and voucher identity.
- Extend ownership-consistency guards to prevent mixing a new principal's payment/voucher/application/document with another owner's chain. For new notifications require an explicit voucher-access association in the creating transaction.
- Retain the immutable-payment trigger's existing protected-field comparison: new ownership/checkout columns must remain immutable too. Never exempt them to enable backfill. Quotes remain immutable.
- Keep unique `vouchers.payment_id` and `applications.voucher_id`, existing revisions, declarations and storage keys. Keep private storage with no public object policies.

Adding nullable columns and relaxing the legacy-only owner constraint is necessary because fresh applicants will no longer have a `profiles`/`auth.users` row. The XOR owner check replaces that constraint with an explicit, equally mandatory ownership choice. This is a compatibility expansion, not a deletion/recreation of existing tables.

## Applicant sessions and the RLS boundary

An opaque applicant cookie does not make Supabase `auth.uid()` return an applicant identity. Simply replacing login while retaining the old owner policies would fail. Using unrestricted service-role queries as a substitute would also be unsafe: the service role bypasses RLS.

Recommended boundary:

1. Browser communicates only with CruiseApply applicant APIs, using a dedicated HttpOnly cookie. It receives no database bearer token or service key.
2. The server verifies the session for routing and calls narrowly scoped database RPCs. Each protected applicant RPC independently resolves the supplied session capability, expiry, credential version and voucher scope before accessing records. It never accepts a browser-provided owner as authority.
3. Session creation is service-only and occurs only after salted scrypt PIN verification. Under lock, recheck the verified credential hash/version and revocation state before inserting a session; a concurrent PIN change must invalidate the attempted login.
4. Application/payment/document IDs are resource selectors, not authorization. SQL resolves the allowed application from the session's voucher and checks every selector against it. Functions return explicit applicant-safe fields, never raw unrestricted joins or `SELECT *` payloads.
5. Ordinary applicant reads also use this scoped boundary. No helper may merely receive an arbitrary `applicant_id` from the browser and use the service key to query it.

At the coordinated cutover, replace the legacy applicant `owner_read` policies on payments/vouchers/applicants/applications/documents/notifications and the child `application_owner_read` policies with staff-only `is_admin()` read access for authenticated database users. Public job/product policies remain. Keep `admin_notes`, audits and employer/matching records staff-only. Keep voucher credential column grants restricted. Restrict old applicant profile editing to the remaining intended staff/legacy administration path.

This preserves deny-by-default direct database isolation, but deliberately replaces applicant JWT/`auth.uid()` RLS ownership with explicit database session-capability checks. That security boundary must be reviewed and tested; it is not accurate to claim that existing applicant RLS automatically protects service-role operations. A separate limited database execution role can be added later if hosting/connection configuration supports it; it is not assumed available.

Supabase reference: [RLS and service-role behavior](https://supabase.com/docs/guides/database/postgres/row-level-security).

## RPC and application changes

- New service-only checkout operations: create/resolve guest checkout, create immutable regional quote, initialize/reuse payment from that quote, fetch authorized purchase status and claim credential delivery. New contact email is frozen at checkout, not loaded from `auth.users`; it must still match server-side Paystack verification.
- Extend the existing `fulfill_verified_payment()` through a new reviewed migration, preserving its signature where possible and all status/amount/currency/email/provider-ID checks, locking, one-voucher uniqueness and duplicate early-return behavior. Issue the access binding and notification scope atomically with a new voucher. Existing successful rows must take the unchanged idempotent path.
- New service-only session operations: finalize verified voucher login, resolve/rotate/revoke session and logout. No applicant credential path can create a staff session or staff role.
- Add session-scoped application operations for read/list, redeem, autosave, education/experience/questions, register/remove document, submit and notification read/list. Reuse validation, row locking, revision checks and idempotency, but not the old assumption that `p_user_id` is sufficient authorization.
- Keep PIN checking server-side in Node using the existing scrypt/hash format. Do not move plaintext PINs into SQL arguments, logs or Supabase Auth. Database session creation receives the previously verified hash/version plus server-minted token material, not the PIN.
- Modify `review_application()` only where it addresses applicant notifications; retain staff session actor, role locking, allowed transitions, expected revision, request conflict checks, atomic history/notification/audit writes and terminal restrictions. Staff notes and staff download authorization remain separate.
- Split `requireStaffSession`/`apiStaffSession` from `requireApplicantSession`/`apiApplicantSession`; split profile loaders and logout. Applicant APIs must stop accepting legacy Supabase applicant cookies after cutover.
- Keep public registration disabled/removed from the applicant journey and remove its public signup API branch at cutover. Staff onboarding is controlled invitation/provisioning, with existing staff password/reset authentication retained. Existing Auth users are not deleted.
- Keep document upload validation, private bucket and server streaming. New storage keys use a namespaced applicant principal path; legacy object paths remain unchanged. Authorization comes from the application/document relationship, not from assuming a path prefix is an Auth user UUID.

## UX and credential delivery

`Buy Voucher -> Verify payment -> Receive Serial + PIN -> Applicant Login -> Start/continue application -> Dashboard/tracking`

- Public `/buy-voucher`: country-aware product/price review and contact fields; no account registration or password prompt.
- Payment return page: binds to the guest checkout cookie/capability. A Paystack reference in the URL is never sufficient to reveal credentials, personal details or a receipt. The webhook can fulfill without any browser session; the browser polls only its authorized checkout.
- Credential delivery: intentional, protected display of serial/PIN after verified payment. Recoverable until the short delivery window closes; making display strictly one-shot before the browser receives it risks losing credentials on a dropped response. Never mark a delivery consumed merely because fulfillment completed.
- The initial delivery necessarily shows the applicant their PIN transiently. The prohibition is on unauthorized disclosure/plaintext persistence: no URLs, analytics, logs, audit metadata, localStorage, sessionStorage, service-worker cache or routine receipt. Set no-store responses, suppress third-party/session-replay scripts and clear PIN state on navigation. Keep encrypted-at-rest material only as needed for controlled delivery/rotation, with the current encryption key server-only.
- Applicant Login: serial and PIN only, sent via POST over HTTPS; generic failure message. Successful login sets a random session cookie, not the PIN.
- New unused voucher: select the managed opportunity/start its one application. Used voucher: resume its existing application/dashboard. Repeated login must not redeem again, increment revision, create notifications or create another application.
- Header: Buy Voucher and Applicant Login; separate Staff Login. Existing `/login` should lead to applicant login or a clear role chooser; `/staff/login` retains password authentication. Old `/register` links should explain the voucher flow and link to buying/logging in, not silently create accounts.
- Ordinary receipt: payment details and serial as appropriate, no reusable PIN. New principal profile editing must not silently overwrite immutable payment contact snapshots.
- The existing additional-information status/message remains visible. An applicant reply/document-reopening workflow is separate unfinished work; this auth change does not invent that channel.

## Security and product decisions to approve

1. **Access scope:** recommend one voucher/application per login; no automatic household/account/email aggregation or voucher transfer/merge UI.
2. **90-day validity:** recommend treating existing `expires_at` as the deadline for starting an application, not expiring login to a submitted application's tracking. Define retention and explicit credential revocation independently. Decide the treatment of expired unused and refunded/cancelled vouchers before implementation; do not silently lock a submitted applicant out.
3. **PIN strength:** existing PINs are eight numeric digits, with salted scrypt hashes and AES-256-GCM ciphertext. Keep legacy credentials valid. Because PINs become long-lived authentication, require distributed per-voucher and trusted-IP throttling, generic errors, equivalent work for missing serials, progressive delays and scrypt concurrency limits. Recommend reviewing a longer format for newly issued credentials separately; no existing PIN rotation is assumed.
4. **Recovery:** recommend a dedicated verified-contact recovery procedure that rotates the PIN and revokes sessions. Knowing an email, serial or payment reference must never reveal/reset a PIN. Payment email matching is not proof of mailbox ownership. Until a verified recovery channel is approved, provide a clearly described manual support route, not an insecure automated reset.
5. **Session policy:** proposed defaults are a nonpersistent `__Host-` HttpOnly/Secure/SameSite=Lax cookie, 30-minute idle expiry and 12-hour absolute expiry, with independent checkout/session cookies. Rotate after authentication; enforce expiry and revocation in the database. Approve these timeouts before treating them as product policy.
6. **Domain/CSRF:** use one canonical HTTPS purchase/callback/portal origin; configure allowed origins explicitly. A localhost callback will not receive a cookie issued on a different tunnel host. Require same-origin mutation checks and CSRF protection, including login/logout; no bearer secrets in query strings. Local HTTP exceptions must never become production cookie defaults.
7. **Bearer-credential risk:** anyone with serial and PIN can act as that applicant. Separate payment success from identity assurance; do not claim a paid voucher proves identity or eligibility. Protect sensitive documents and provide session revocation/recovery.

Session guidance: [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) and [OWASP Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).

## Legacy preservation and rollout

1. Approve the identity model, scope and unresolved lifecycle/recovery choices before code changes. Keep webhook E2E checkout paused.
2. Prepare migration 0008 for compatibility schema expansion: new tables, nullable new owner columns, XOR constraints, indexes and extended immutable-identity guards. Do not rewrite any existing payment, quote, voucher, application, document path, notification or PIN. Owner reviews/applies manually.
3. Prepare migration 0009 for additive checkout/session/application RPCs and ownership-aware fulfillment/staff-notification routing. Preserve callable legacy behavior during implementation. All new paths remain feature-disabled until tested. Owner reviews/applies manually.
4. Add legacy `voucher_access` mappings without rewriting original records. Validate each voucher/payment/application ownership chain before creating a binding. For notifications, link only records whose attribution is proven; do not expose all notifications from the same legacy user. Ambiguous historical account-wide notices require an explicit review rule. The known original one-voucher/one-application chain should be verified read-only and adopted without modifying its business records.
5. Implement and test the separated routes/UI against disposable fixtures. Confirm that used original voucher CRV-2026-00000003 can log in under its existing credentials and read APP-2026-00000001 without redeeming/submitting it again. Never print those credentials in test output.
6. Prepare a separately reviewed cutover migration 0010 for RLS/grant changes and legacy applicant endpoint retirement. Apply in a controlled maintenance/cutover window with the new application deployment; applying these policies while old applicant code is live would break its dashboard. Staff authentication remains usable throughout.
7. Rollback after new guest purchases exist must fail closed to applicant maintenance, retaining staff access and all data. Do not roll back to old code that assumes every new row has `user_id`, and do not drop the new schema or reopen legacy owner access casually.
8. Resume a fresh Paystack Test Mode webhook E2E only after the redesigned guest purchase flow is verified and the manual cutover is complete. No new Paystack transaction belongs to this analysis stage.

## Acceptance tests before cutover

- Guest quote/initiation retries, country/region/FX snapshots, exact GHS minor units and contact snapshot matching; no Auth user created.
- Callback without cookie, guessed payment reference, wrong checkout capability, expired delivery capability, webhook-before-callback and callback-before-webhook; no credential leakage.
- Valid login, invalid/nonexistent serial, wrong PIN, rate limiting, fixation, session rotation, idle/absolute expiry, logout and revocation; no plaintext PIN in persisted browser/server artifacts.
- Login with used voucher and after redemption validity ends under the approved tracking policy; exactly one application and unchanged existing submission.
- Two vouchers sharing one contact email, and two legacy vouchers sharing one Auth user: no cross-voucher access, even with altered application/document/notification/receipt IDs.
- Direct anon and legacy applicant Supabase access denied after cutover; staff RLS still works; new session RPCs reject arbitrary owner IDs, stale/revoked capabilities and cross-scope resource IDs.
- Private documents remain inaccessible without the appropriate session; legacy storage paths still work; staff notes/audit metadata never enter applicant payloads.
- Staff login, review, notes, download audit, notification routing and role revocation unchanged for legacy and new applications.
- Existing successful/unpaid payments, voucher hash/ciphertext, original application, histories, notifications and document paths compared by non-sensitive digests before/after; no rewriting originals to make tests pass.
- Full TypeScript/lint/unit/production build and hosted/browser/concurrency checks; disposable fixtures removed. Existing tests remain evidence of the old architecture, not evidence that this redesign has already passed.

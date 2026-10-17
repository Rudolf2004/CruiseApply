> Current status: 0011 is applied and fully hosted-verified. See [hosted evidence](GUEST-CHECKOUT-0011-HOSTED.md). The pre-application instructions below are historical; do not rerun 0011.

# Migration 0011: guest checkout and initial credential claim

**Review only — not applied. Applicant rollout remains disabled.**

Migration: [202610030011_guest_checkout_claim.sql](../supabase/migrations/202610030011_guest_checkout_claim.sql). Requires applied 0001–0010. The complete SQL is in that file; do not rerun earlier migrations.

## Changes

- Activates principal ownership for new guest records by making seven existing `user_id` columns nullable. The existing XOR constraint still requires exactly one owner, and immutable-owner triggers prevent reassignment. Existing rows keep their original owners; there is no backfill or business-row DML.
- Adds parent ownership checks and unique indexes: one payment per guest checkout, one voucher and application per principal. Equal email addresses never merge principals.
- Adds service-only begin/quote/payment/status/claim operations. Checkout capabilities are random 256-bit server-generated secrets in Secure/HttpOnly/SameSite cookies; SQL stores SHA-256 hashes only. Contact and country bindings are immutable. Existing regional quotes and GHS charge snapshots remain authoritative.
- Extends the existing verified fulfillment RPC for principal-owned payments, retaining amount/currency/email/provider checks, payment locking and replay behavior. New vouchers contain neither PIN plaintext nor PIN ciphertext. Pending access, contact, claim delivery and one notification are created atomically. The server still verifies with Paystack first; legacy fulfillment remains compatible.
- Initial claim locks checkout, payment, voucher, access and delivery. Exactly one successful claim installs a new scrypt hash and consumes delivery atomically with a bounded applicant session and safe audit records. The server returns the new Serial/PIN once, only after commit. Neither SQL nor subsequent requests can retrieve that PIN. Lost responses require verified reset, not replay disclosure.
- Adapts scoped application, document, submission and staff-review notifications to either ownership form. Internal principal engines cannot be invoked directly by anon, authenticated or service_role; only the narrow security-definer wrappers call them.

No existing RLS policy is replaced. Staff authentication, review transition rules, private notes, employer matches, pricing and existing payment/voucher records remain unchanged. No Paystack operation runs during migration.

## Security and lifecycle

The application’s service role is a trusted server boundary, never a browser credential. All new callable operations revoke PUBLIC/anon/authenticated access, fix the SQL search path, and expose no PIN/session hashes in portal DTOs. The guest boundary also enforces same-origin mutation requests, rate limits, no-store responses, duplicate-cookie rejection and Test Mode only.

An unused, valid, verified voucher may be claimed and redeemed. Used vouchers retain login/tracking after ordinary expiry. Expired unused vouchers cannot initiate applications. Cancelled/refunded vouchers cannot claim new entitlement or redeem; existing access can retain tracking unless separately suspended/revoked. Session authorization remains independent from voucher status. Session idle expiry is seven days; absolute expiry remains fixed at thirty days.

PIN reset/email verification is the next dependency and is **not delivered by 0011**. No SMS/WhatsApp is introduced. Rollout must remain disabled until recovery and the controlled complete E2E are ready. Checkout capabilities expire after 24 hours; an expired/lost capability requires the subsequent verified recovery process, not email/reference-based credential disclosure.

## Validation and rollback

Local PostgreSQL execution passed with all earlier migrations, simulated Supabase roles, disposable data and private-storage metadata. Tests cover late-failure transaction rollback, unchanged existing rows/RLS, service-only privileges, charge snapshots, idempotent fulfillment, one-time claim, principal isolation, scoped application/documents/submission, staff review and legacy fulfillment replay. Evidence: `test-results/guest-checkout-0011-local.json`.

TypeScript, lint, 132 unit tests, production build and disabled-route HTTP/headless Edge checks at mobile and desktop widths also passed. The read-only catalog query was executed locally and verifies all 22 changed/new function definitions and permissions, ownership columns, constraints/indexes/triggers, and existing RLS policies.

This is not a hosted or provider-origin result. True concurrent guest claims, hosted role grants/storage behavior and full browser/provider checkout must be verified after manual application. No new Paystack transaction was made.

The entire migration is transactional: any failure rolls back its schema/function changes. After a successful application, do not blindly reverse nullable ownership columns once guest rows exist. Keep rollout disabled, preserve rows, and use a reviewed forward correction if needed.

## Manual step after final review

1. In the existing Supabase project's SQL Editor as `postgres`, run **only** `supabase/migrations/202610030011_guest_checkout_claim.sql` once. Expected: `Success. No rows returned.`
2. Run `supabase/configuration/verify-0011-readonly.sql`, then save the complete `verification_0011` JSON result as `supabase/configuration/verification_0011.json`.
3. Report success. Hosted authorization, concurrency, ownership, claim/session and preservation tests will then run using disposable fixtures, followed immediately by verified PIN-reset implementation. Do not enable rollout or create a Paystack payment for this step.

> Applied and fully hosted-verified on 2026-10-04. See [hosted evidence](VOUCHER-RECOVERY-0012-HOSTED.md). Preparation/manual steps below are historical; do not rerun 0012.

# Migration 0012: verified voucher PIN recovery

**Review only, not applied.** [Exact SQL](../supabase/migrations/202610030012_voucher_pin_recovery.sql). Requires applied 0001–0011. No new table, RLS change, business-row DML, backfill, email or Paystack call occurs when applying this migration.

## Operations and security

Three service-only RPCs request, complete and revoke a recovery challenge. An internal locking helper is not callable directly, including by service_role. All functions use a fixed empty search path. Locks follow payment → voucher → access → principal → contact/challenge → sessions to serialize recovery with login, claim, logout and portal operations.

Requests accept a voucher serial or payment reference. They never accept a replacement recipient, owner ID or PIN from the browser. An identifier alone does not grant access: the server generates a random 256-bit code, stores only its SHA-256 hash, and sends the code exclusively to that voucher's stored contact. Legacy contacts are bound on explicit request from the immutable payment customer email, without modifying legacy payment/voucher/application ownership or creating an applicant Supabase Auth account. Before email proof, request/binding audits deliberately have no applicant actor; only successful verified rotation is attributed to the principal.

Codes expire after 15 minutes. A fresh request revokes older reset challenges. Completion checks the specific voucher/access/contact/version and unconsumed, unrevoked, unexpired code under lock. It verifies the contact and atomically installs a newly generated scrypt PIN hash, advances the credential version, revokes every applicant session, consumes the code, invalidates other challenges and unclaimed initial delivery, and records a body-free audit event. SQL never receives or stores the raw PIN/code. No new session is issued by reset: the applicant signs in again with the new PIN, displayed once. A lost response requires another verified reset.

Used vouchers retain recovery/login/tracking despite ordinary expiry. Unused expiry still prevents redemption. Cancelled or refunded purchases with no existing application cannot recover new paid entitlement; existing applications may retain tracking unless access/principal is suspended, revoked or disabled. `refunded` is the payment state in the current schema, not a new voucher enum value. No reset changes entitlement status.

Two existing redemption functions are replaced with the same signatures/ACLs so their proof check uses the current access hash after rotation. Old legacy PIN proofs cannot redeem after reset; the scoped portal supplies the current locked proof. Existing legacy voucher hash/ciphertext rows remain untouched. The legacy receipt hides historical PINs once rotated/restricted. Staff Supabase authentication and unrelated voucher sessions remain unchanged; historical Supabase-account sessions are not applicant-principal sessions and remain part of the separately controlled legacy cutover.

## HTTP, browser and mail boundary

The existing `APPLICANT_AUTH_ENABLED` switch guards `/applicant/recovery` and both recovery APIs. Same-origin HTTPS checks, strict input allowlists, bounded body parsing, global/client/identifier rate limits and no-store/no-referrer responses protect the boundary. Request responses are identical for known and unknown identifiers. Email delivery runs after the response, avoiding recipient/provider timing disclosure and retaining the raw code in server memory only. There is no plaintext outbox. If delivery is ambiguous or fails, the challenge is revoked and only a fixed, secret-free diagnostic is logged. A process crash may require the applicant to request another code.

A Resend transport adapter is prepared using its [official send-email API](https://resend.com/docs/api-reference/emails/send-email). It is **not configured or enabled**. Before email E2E/release, configure a verified sending domain/address and a sending API key in the server environment (`EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`). Never paste keys into chat. Keep tracking/link rewriting disabled for security messages; the recovery code is plain email text, not a URL parameter. No SMS/WhatsApp or applicant Auth account is created. Provider delivery, sender DNS and mailbox completion remain external tests.

## Validation and next manual step

See `test-results/voucher-recovery-0012-local.json` for exact local SQL/rollback, privilege, token/version/lifecycle, session invalidation and legacy compatibility checks. The migration has not been hosted-tested or applied. True parallel reset/login/claim races will be exercised with disposable hosted fixtures after application.

After reviewing the SQL:

1. Run only `supabase/migrations/202610030012_voucher_pin_recovery.sql` in the existing Supabase SQL Editor as `postgres`. Expected: `Success. No rows returned.` Do not rerun earlier migrations.
2. Run `supabase/configuration/verify-0012-readonly.sql`; save the complete `verification_0012` JSON as `supabase/configuration/verification_0012.json`.
3. Hosted recovery concurrency/preservation tests follow immediately, then applicant responses and withdrawal. Keep rollout disabled and Paystack in Test Mode; no payment is required for this migration verification.

A failure partway rolls back the whole transaction. After successful application, do not revert rotated credentials or revive revoked sessions. Fix forward under review; preserve the access hashes/version and audit history. The migration itself rotates no credentials and changes no existing data.

Final local validation (2026-10-04): TypeScript, full lint, 146 unit tests, production build, exact local SQL/catalog/rollback checks and disabled-route HTTP/Edge checks at 390px and 1440px passed. The slow host required increasing test-request timeouts; no application timeout or security boundary changed. Hosted 0012 verification and real email delivery remain pending.

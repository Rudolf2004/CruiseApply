# Migration 0012: hosted verification passed

The owner applied 0012. The complete saved catalog at `supabase/configuration/verification_0012.json` matches the exact locally executed SQL, including all six function definitions/security settings/permissions and the unchanged ownership, RLS, constraints, indexes and triggers. PostgreSQL's NOT NULL catalog representation difference is normalized; all 210 required columns were independently confirmed using hosted OpenAPI metadata.

Hosted disposable-fixture checks passed on 2026-10-04:

- Anonymous and authenticated callers cannot execute recovery operations; the private locking helper also denies direct service-role calls.
- Six competing resets and six old-proof logins produce one rotation. All old sessions are revoked; the winning hash/version is authoritative, with one rotation audit.
- Request audits have no unverified applicant attribution and no private metadata.
- Recovery codes are isolated between vouchers sharing an email. Lost first-claim recovery prevents subsequent initial claim.
- Guest initialization/claim, application redemption/save, private storage, submission, staff review, scoped notifications and logout regressions pass.
- Every fixture was removed. Before/after hashes of all public business tables match, including the original successful payment, voucher and application.

Evidence: `test-results/voucher-recovery-0012-catalog-comparison.json`, `test-results/voucher-recovery-0012-hosted.json` (`passed=true`, `cleaned=true`). Source catalog SHA-256: `73fa324cffcfdba8c4bd8bc2d75a42ece2f2ebaca85a0f2ac96290492719b2a3`.

The fulfillment fixtures exercise the database's trusted-provider boundary with synthetic inputs; they are not Paystack transactions. No provider API, email delivery, auth cutover or original-record mutation occurred. Real sender/mailbox verification and the complete enabled applicant journey remain pending. Local lifecycle, legacy-reset, expiry, contact-version and rollback checks are recorded in the migration review.

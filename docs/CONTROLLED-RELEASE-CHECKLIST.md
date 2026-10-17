# Controlled release and operations checklist

Development checklist, not production approval. Applicant rollout remains disabled and Paystack stays Test Mode.

## Release dependencies

- Applied migrations must match their exact local catalog and pass hosted authorization/concurrency/preservation checks. 0008?0016 have passed exact hosted catalog and safe authorization/concurrency/preservation checks.
- Regional-pricing/settings administration is implemented and hosted RPC-tested. Complete actual email delivery, enabled applicant E2E and final release UX/accessibility checks. See [external setup](E2E-EXTERNAL-SETUP.md).
- Configure a verified Resend sender for recovery: EMAIL_PROVIDER=resend, RESEND_API_KEY in deployment secrets, EMAIL_FROM set to the verified sender. Test actual mailbox delivery and generic unknown-voucher behavior; never paste keys or codes into issue logs. SMS/WhatsApp are out of scope.
- Use a stable HTTPS application origin for NEXT_PUBLIC_APP_URL. Configure Paystack Test webhook to that origin plus /api/payments/webhook. Validate provider-origin delivery and duplicate handling using the final controlled checkout only when the enabled guest flow is ready. Do not initialize extra transactions while schema testing.
- Confirm Supabase staff redirect URLs and staff recovery delivery. Applicant credentials remain Serial+PIN and are unrelated to staff Supabase passwords.

## Controlled applicant test

Use an isolated HTTPS deployment with approved Test Mode keys. Enable APPLICANT_AUTH_ENABLED only for the controlled E2E release, after schema and recovery dependencies are ready. Do not toggle the development environment during routine implementation.

Exercise guest country selection/GHS quote, verified Test Mode purchase, one-time credential claim, secure cookie issuance, repeated callback/webhook, login, draft/autosave/upload/submit, staff screening/notes, notifications, additional-information reply, withdrawal on a separate eligible fixture, PIN reset and session invalidation. Check cross-voucher isolation for the same email, original legacy tracking, revoked/expired sessions and used-voucher tracking after expiry. Check private documents on desktop and mobile. Positive employer referral testing requires a real authorized employer opportunity and explicit applicant consent; no fabricated match.

## Deployment and observability

Run typecheck, lint, unit/SQL integration tests, production build and enabled browser/accessibility regression before release. Deploy the reviewed immutable artifact with server-only secrets supplied by the host. Keep service-role and Paystack keys out of public environment variables and client bundles. Do not enable Live Mode without a separate approved activation.

Monitor generic route failure counts, provider verification failures, webhook response codes, email delivery failures and database errors. Never log request bodies on auth/claim/recovery/webhook/document endpoints, Authorization/Cookie headers, PINs, raw capabilities, recovery codes or document contents. Configure alerts using redacted aggregate signals rather than applicant PII. External monitoring/alerts are not yet configured.

## Backups and rollback

Before production activation, confirm hosted database backup retention and restoration capability in the Supabase project. Document private-storage backup/recovery separately; a database backup does not establish document-object recoverability. Restore a backup into an isolated environment and verify relationships and private document access before claiming disaster recovery is tested.

If rollout fails, disable APPLICANT_AUTH_ENABLED and redeploy the last compatible application artifact. Do not delete principal-owned records or force them into legacy user ownership. Existing staff authentication remains independent. Keep additive migrations in place unless a separately reviewed recovery plan requires otherwise. Reconcile payments through normal provider verification only; never directly mark paid or insert replacement vouchers.

Pending operational decisions: backup retention/recovery objectives, monitoring provider, orphan-upload reconciliation and final policies. No automated destructive cleanup is enabled by this document.

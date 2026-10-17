# Migration 0011 — hosted verification PASS

The complete hosted export in `supabase/configuration/verification_0011.json` was compared against the exact local migration catalog. All 22 function definitions/security settings/ACLs, 211 check/key/FK constraints, 97 indexes, 24 triggers, 21 RLS policies, 14 ownership columns, eight private tables and two voucher credential columns match.

PostgreSQL 18 includes table NOT NULL constraints in `pg_constraint`; the hosted catalog uses the older representation. The comparator explicitly accounts for these 210 local-only entries, and the hosted test independently verified all 210 required columns using the service-role OpenAPI schema. Changed owner/PIN nullability was separately compared directly. See the [PostgreSQL 18 catalog](https://www.postgresql.org/docs/18/catalog-pg-constraint.html) and [PostgreSQL 17 catalog](https://www.postgresql.org/docs/17/catalog-pg-constraint.html).

Hosted disposable-fixture checks passed:

- anonymous/applicant/staff JWT denial; internal helper denied even to service_role;
- same-email principals remain separate; GH and NG use authoritative GHS 15000 and GHS display fallback;
- six concurrent initializations create one payment; unpaid claim and foreign quote denied;
- six simulated verified fulfillment calls create one voucher and one Voucher ready notification; mismatched amount rejected;
- eight competing claims yield exactly one credential hash, consumed delivery and session, with seven rejected claims; no voucher PIN plaintext/ciphertext;
- seven-day idle and fixed thirty-day absolute session lifetime;
- principal-scoped redemption/autosave concurrency, real private Storage upload/access denial, submission, staff review and notifications;
- logout replay and revoked-session denial;
- all temporary records, auth accounts and storage objects removed; every public-table snapshot matches its pre-test state.

Evidence: `test-results/guest-checkout-0011-catalog-comparison.json`, `test-results/guest-checkout-0011-hosted.json`. Runner: `scripts/verify-guest-checkout-hosted.mts`. The hosted tests simulate the trusted verified-payment boundary with disposable DB fixtures; they made **zero Paystack API calls** and do not substitute for a provider-origin checkout/webhook test. Rollout remains disabled.

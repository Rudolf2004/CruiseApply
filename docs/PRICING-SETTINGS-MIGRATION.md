> Applied and hosted-verified. See [0016 results](PRICING-SETTINGS-0016-HOSTED.md). The review instructions below are historical; do not rerun 0016.

# Migration 0016: regional pricing, public support settings and export audit

Review only. Migration 0015 is applied and hosted-verified; 0016 has NOT been applied. Do not rerun 0001–0015.

## Changes

[202610100016_pricing_settings.sql](../supabase/migrations/202610100016_pricing_settings.sql) adds one private command table and two service-only functions:

- `save_pricing_configuration`: a verified server-supplied super-admin actor may edit regions, country-to-region mapping, approved display FX metadata, authoritative GHS country/region overrides, or the two public support-contact settings.
- `record_staff_export`: a verified staff actor records an allowlisted page export being prepared. It stores record type, page and row count only; never row contents or search text. An audit event does not assert that the browser received or saved the download.
- `pricing_configuration_commands`: request UUID, staff actor, entity/key and exact expected/new configuration. RLS permits staff reads only; service insert/delete, no API-role updates; anonymous/applicant access is denied.

No existing configuration values, rates, mappings, prices, contacts, payments, applications or credentials are written when the migration is applied. No RLS policy is replaced. No column is removed. Everything runs in one transaction and a late failure rolls back.

## Security and concurrency

The API verifies the staff Supabase session, derives actor_id server-side, checks same-origin and validates a strict payload. The RPC independently checks and locks the current database role. Only super_admin may change pricing/public support settings. Public support settings are restricted to support_email/support_phone; arbitrary keys, credentials, provider secrets, applicant rollout and Paystack mode cannot be edited.

Request locks make identical retries return one result; conflicting actor/entity/key/payload fails. Per-record advisory locks cover both insertion and update. Existing rows are locked and compared with the entire expected row, catching changes made outside these controls as well. Configuration writes, the immutable command and staff-attributed audit commit atomically. Audit metadata excludes configuration values.

Country selection remains worldwide: this operation changes only region_id, never country availability. FX requires a positive bounded rate, actual source and effective/expiry timestamps. GHS cannot be a display FX quote; actual charges remain GHS. No fabricated/default rates are included. Existing immutable quote/payment snapshots remain unchanged. Future/expired FX continues to use the existing fallback rules.

The support contact values are intentionally PUBLIC and displayed on the contact page after validation. They are not verified email sender settings and do not enable recovery email delivery. Enter only the operator's approved public contact information.

Exports still use the staff-session database client and existing RLS, fixed columns and 25-row pages. Service access is used only to record the audit and recheck staff authorization. Exports fail closed if that audit cannot be committed. This dependency means the updated export implementation requires 0016 before release.

## UI

Admin record views link to region/country/FX/override editors. Super-admins can add regions and reviewed overrides/rates; no rate or price is prefilled for new records. The public-contact link in admin navigation edits only the allowlisted contact settings. Ordinary staff retain authorized read views and exports.

No paid records can be manually marked successful, refunded or issued a replacement voucher through these controls. Provider reconciliation and final enabled applicant/staff browser E2E remain separate tasks.

## Verification

Local exact SQL execution, injected late-failure rollback, zero business-row changes on installation, service-only grants, super-admin authorization, expected-row conflicts, request retry binding, all five configuration branches, invalid arbitrary settings, unchanged historical payment/quote snapshots, applicant ledger isolation and minimized export audits passed. Synthetic FX/contact examples were used ONLY in isolated local PostgreSQL, not hosted Supabase.

The full 182-test suite and TypeScript passed. Final lint/build/browser completion is recorded in IMPLEMENTATION.md. Real hosted concurrency is pending manual application.

Prepared hosted tests use a disposable staff account, draft intake, inactive product, inactive pricing region and inactive override. They do not alter actual country mappings, insert FX rates, publish contact information or change the approved product. Invalid FX/contact operations are checked for rejection; positive FX/contact behavior was tested locally. All fixture IDs and original public-table hashes are recorded for cleanup/preservation checks.

## Manual Supabase step

In the existing project's SQL Editor as postgres:

1. Review and run only `supabase/migrations/202610100016_pricing_settings.sql` once. Expected result: `Success. No rows returned.`
2. Run `supabase/configuration/verify-0016-readonly.sql` and save the complete verification_0016 JSON object to `supabase/configuration/verification_0016.json`.

Then the development agent will run `node scripts/compare-pricing-controls-catalog.mts` followed by `node --env-file=.env.local scripts/verify-pricing-controls-hosted.mts`, confirm cleanup and continue the remaining release/E2E work. No Paystack transaction or applicant-auth rollout is needed for those checks.

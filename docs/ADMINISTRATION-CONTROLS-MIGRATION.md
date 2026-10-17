> Applied and hosted-verified on 2026-10-10. See [0015 hosted results](ADMINISTRATION-0015-HOSTED.md). The review instructions below are historical; do not rerun 0015.

# Migration 0015: administration controls — review only, not applied

Review [202610100015_administration_controls.sql](../supabase/migrations/202610100015_administration_controls.sql). Migrations 0001–0014 are already applied; do not rerun them.

## Delivered in this stage

- Staff-only searchable, paginated views for payment history, voucher inventory, managed/research intake records, legacy/staff accounts, products, pricing regions, country mappings, FX configuration and audit events.
- Operational status counts and page-sized CSV exports. CSV exports use the authenticated staff database client and existing RLS; fixed column allowlists exclude PINs, hashes, tokens, private notes, passport data, document paths and audit metadata. Spreadsheet formula prefixes are neutralized. Exports are private/no-store, limited to the selected 25-record page, and are not financial settlement reports.
- Managed-intake creation/editing with explicit status, required documents and applicant questions. Existing research/sample/employer-assigned records cannot be converted or published through this operation. No salary, ship, contract or employer facts are invented.
- Super-admin product editing for GHS minor-unit price, description, validity and availability. Existing quotes, payments and applications remain unchanged.

## Exact database changes

1. Add `admin_revision integer NOT NULL DEFAULT 0` with nonnegative checks to jobs and voucher_types.
2. Add `administration_commands`: an immutable request/result ledger with staff-only RLS reads, service insert/delete privileges, request UUID uniqueness and actor foreign key. No applicant/anonymous access and no API-role update privilege.
3. Add service-only `save_administration_record(uuid,uuid,text,jsonb)` with two allowlisted operations: intake_save and product_save.

The server obtains actor_id from its verified Supabase staff session. SQL rechecks and locks admin/super_admin membership; product changes additionally require super_admin. Advisory request locking serializes identical retries. Row locks and expected revisions reject stale edits; different payload or actor on the same request UUID fails. The command, configuration update and staff-attributed audit are atomic. Audit metadata contains request ID/revision, not configuration text. Foundation generic job audit remains in addition to the attributed event.

An intake with an application can change status only. Its content, service description, questions and document requirements cannot silently change; create a new intake for revised requirements. Existing application/service/payment snapshots are not updated. New records are managed CruiseApply intake, with no employer assigned. Applying the migration creates no opportunities or products and changes no business-row values other than adding compatibility columns with revision zero.

No payment status manipulation, voucher credential access, refund, account-role editor, rollout control, PIN operation or employer transmission is introduced. Pricing does not select Paystack mode. Live Mode remains prohibited during development.

## Security and compatibility

All DDL runs in one transaction. A failure rolls back the expansion. Existing tables retain their RLS and ownership constraints; current authentication/RPCs are not replaced. Foreign keys use default NO ACTION. No secret is stored in the command payload; these payloads contain only the allowlisted intake/product configuration. Do not put secrets in public product/intake descriptions.

Operational limits: report counts are current queries, not an atomic financial ledger snapshot. CSV exports currently do not create a separate export audit event. Region/country/FX/override editing, broader settings and financial reconciliation controls remain separate unfinished administration work; this stage supplies read views and does not claim those editors are complete. API callers cannot supply arbitrary tables/columns or change currency through product_save.

## Validation

Local exact SQL execution, forced late-failure rollback, existing-row preservation, service/API-role authorization, staff-only command RLS, retry conflicts, revision checks, existing-intake contract protection, super-admin pricing and body-free audit tests passed. Full unit suite: 176 tests. TypeScript passed. Production build, full lint and disabled-route production HTTP/headless Edge checks at 390px and 1440px passed. Anonymous export and cross-origin configuration requests were denied. Enabled staff editing/browser E2E remains pending hosted 0015. Hosted 0015 and real multi-connection races remain pending manual application.

## Owner's manual step

In the existing Supabase project SQL Editor, as postgres:

1. Review and run only `supabase/migrations/202610100015_administration_controls.sql` once. Expect `Success. No rows returned.`
2. Run `supabase/configuration/verify-0015-readonly.sql` and save the entire verification_0015 JSON object at `supabase/configuration/verification_0015.json`.

Then the development agent will compare the full catalog with `node scripts/compare-administration-catalog.mts` and run `node --env-file=.env.local scripts/verify-administration-hosted.mts`. The runner creates only a disposable staff account, draft intake and inactive product; tests concurrency/permissions/audits; cleans fixtures; compares all original public-table snapshots. No Paystack API call or original-product update is made.

Do not manually edit the original application, voucher, payment or approved product to satisfy a test. On a failed verification, inspect its fixture ledger before retrying.

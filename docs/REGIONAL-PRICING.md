# Regional pricing and Paystack

## Migration 0003: applied

The owner confirmed migrations 0001, 0002 and 0003 are applied. Do not rerun them. Hosted regional-pricing integration checks passed after 0003: country/region precedence, GHS/local-display separation, missing/stale FX fallback, immutable snapshots, owner/expiry checks and six concurrent quote initializations producing one payment. Disposable fixtures were removed. The owner subsequently activated the actual product at GHS 150.00 for Test Mode only.

The [approved initial configuration](INITIAL-PRICING-REVIEW.md) is applied: GHS 150.00, 90 days, seven country mappings, no overrides or FX rates. The [original checkout and fulfillment checks passed](PAYSTACK-E2E.md); actual public webhook delivery remains outstanding. The read-only queries below inspect the already-applied schema; they are not instructions to rerun a migration.

Read-only checks:

```sql
select code, name, amount, currency, validity_days, active
from public.voucher_types where code = 'application-access';

select count(*) as selectable_countries from public.pricing_countries;

select
  has_function_privilege('service_role', 'public.quote_voucher_price(uuid,uuid,text)', 'execute') as server_can_quote,
  has_function_privilege('authenticated', 'public.quote_voucher_price(uuid,uuid,text)', 'execute') as client_can_quote,
  has_function_privilege('service_role', 'public.create_payment_from_quote(uuid,uuid,text,uuid)', 'execute') as server_can_initialize,
  has_function_privilege('authenticated', 'public.create_payment_from_quote(uuid,uuid,text,uuid)', 'execute') as client_can_initialize;
```

Current expected product: **CruiseApply Application Access**, `amount = 15000`, `currency = GHS`, `validity_days = 90`, `active = true` (Test Mode only). Expected country count: 249. Function privileges: `true`, `false`, `true`, `false`.

Migration 0003 initially created an unpriced, inactive product. The separately approved configuration supplied its price and mappings. No exchange rate or override has been invented; localized display currently falls back to GHS.

## Configuration model

- `voucher_types.amount` is the authoritative base price in pesewas. `currency` must be GHS for the current merchant. The quote operation rejects any other charge currency.
- `pricing_countries` contains the country selector. Its optional `region_id` maps the applicant's selection to a configured region. `name` can override the standard country label.
- `pricing_regions` defines named pricing regions and their preferred display currencies. Countries can be regrouped without changing application code.
- `voucher_price_overrides` accepts either a country or region for a product, with a positive GHS `charge_amount`. Country override takes priority over region override, then the base price.
- `pricing_currencies` defines display precision. GHS, NGN, USD, GBP, EUR and CAD are included. This is **not** a list of enabled Paystack charge currencies.
- `pricing_exchange_rates` holds a configured quote-currency-per-GHS rate, its source, effective timestamp and expiration. It is only used when effective and unexpired. No external FX feed is assumed or contacted.
- Missing/inactive regions, missing/expired/future FX rates, or estimates outside the safe supported amount range fall back to showing the actual GHS charge. Regional GHS price overrides still apply independently of display FX.

Administrative writes to pricing tables are server/service-only. No public or authenticated client may change prices, rates, quotes or payments. Country selection is readable by signed-in applicants. Administrative configuration screens are a later phase.

## Quote and historical snapshots

1. The signed-in applicant selects their country and requests a price review.
2. The server calls `quote_voucher_price()` with verified user identity. PostgreSQL resolves all pricing and stores an immutable quote for up to 15 minutes, shortened to the selected FX rate's expiration when necessary.
3. The UI explicitly shows the actual GHS charge and, when available, a separate local estimate and rate provenance. It warns that bank conversion/fees may differ.
4. On payment confirmation, the browser submits only the quote ID and optional job ID. `create_payment_from_quote()` checks owner, expiry, product availability and job eligibility, then copies the quote into a payment. Email comes from `auth.users`.
5. Payment snapshots retain country, region, price source, product name/validity, displayed amount/currency/precision and rate metadata. `charge_amount`/`charge_currency` are generated aliases of the existing `amount`/`currency` used by migration 0002. This preserves compatibility and prevents divergent charge values. Update triggers protect quote and payment snapshots from later pricing edits.

The same quote creates only one payment/reference, protected by a row lock and unique key. An already initialized checkout URL can be reused. If a provider request times out before its URL is saved, the user can check the purchase in payment history; no voucher is issued speculatively. A fresh quote represents a separate purchase.

Changing prices or rates does not alter issued quotes within their short validity period or historic payments. Before the first provider initialization, quote expiry is checked again. Legacy payments retain their original charge; absent historical display estimates are not fabricated.

## Paystack flow

Endpoints:

- `POST /api/payments/quote`: authenticated, same-origin, limited pricing review.
- `POST /api/payments/initialize`: authenticated, same-origin, integer GHS pesewas from the payment snapshot. No frontend amount or email is accepted.
- `GET /api/payments/callback`: configured in the initialization request; attempts owner-checked verification and redirects to the receipt or payment history.
- `POST /api/payments/verify`: owner-checked manual retry from payment history.
- `POST /api/payments/webhook`: bounded raw-body SHA-512 HMAC validation using `x-paystack-signature` before processing.

Callbacks, retries and `charge.success` webhooks all use `verifyAndFulfill()`. It independently calls Paystack's verify endpoint and requires a successful status plus matching reference, actual amount, currency, original customer email and test/live domain. Only then can it call `fulfill_verified_payment()` from migration 0002. Unsigned or modified events cannot fulfill. Provider/database failures are not acknowledged as success, so Paystack can retry. The database lock and unique voucher payment ID prevent callback/webhook races from issuing duplicate vouchers. Refund/subscription events do not issue vouchers. Recurring charges and saved authorization codes are not implemented or stored.

Configure the Paystack **Test Mode** webhook URL as `https://YOUR_PUBLIC_APP_HOST/api/payments/webhook` after a public HTTPS deployment or approved tunnel exists. Set `NEXT_PUBLIC_APP_URL` to that same origin and restart/redeploy. Localhost is not reachable by Paystack. The callback URL is supplied explicitly by the application; it does not depend on a dashboard default.

After migration and approved pricing, complete a Paystack test checkout and verify the callback, webhook replay, single voucher, receipt, and historical price snapshots. No real Paystack checkout has yet been completed by these implementation checks.

## Verification evidence

Hosted migration-0002 verification passed: 8 concurrent fulfillment calls returned one voucher and one notification; amount mismatch rolled back; anonymous/authenticated direct fulfillment was denied; PIN hashes were inaccessible to clients; concurrent rate limits admitted exactly the configured count. Temporary records were removed. This database test does not claim provider verification because it deliberately exercises the service-only database boundary with isolated fixtures.

All 33 unit tests, TypeScript, lint and the production build passed. Tests cover raw webhook signatures, rejection of altered/missing signatures, verified transaction mismatches, minor-unit initialization, GHS charge versus NGN display separation, transient webhook failure, duplicate webhook dispatch, checkout URL validation, and preservation of 64-bit provider IDs without retaining authorization data. Hosted pricing SQL checks passed, and the fulfillment concurrency suite passed again after migration 0003, confirming compatibility with the new snapshot protection.

Official references: [Paystack transactions](https://paystack.com/docs/api/transaction/), [Paystack webhooks](https://paystack.com/docs/payments/webhooks/).

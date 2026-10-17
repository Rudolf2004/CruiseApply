# Approved initial test pricing — applied by owner

The owner applied the approved [configuration transaction](../supabase/configuration/initial-test-pricing.sql) and confirmed 249 selectable countries, zero FX rows and zero active overrides. Migrations 0001–0003 and this configuration must not be rerun for the checkout test. The first checkout is initialized; see [the current result and manual browser step](PAYSTACK-E2E.md). Application instructions below are retained as a record.

| Setting | Approved value |
| --- | --- |
| Product | CruiseApply Application Access |
| Validity | 90 days |
| Base charge | GHS 150.00 = 15000 pesewas |
| Paystack charge currency | GHS |
| Country selection | All 249 countries remain available |
| Country/region charge overrides | None initially |
| FX rates | None inserted |
| Initial display | GHS fallback for every country |
| Activation | Active for Paystack Test Mode checkout testing only |

## Approved mappings

| Country | Region | Preferred display currency |
| --- | --- | --- |
| GH | Ghana | GHS |
| NG | Nigeria | NGN |
| US | United States | USD |
| GB | United Kingdom | GBP |
| CA | Canada | CAD |
| DE, FR | Euro display countries | EUR |

Preferred display currencies take effect only when approved, current FX data is configured later. For this first test, all quotes display and charge GHS 150.00. No rates or frontend conversions are invented.

## Manual application

1. Review the complete [configuration SQL](../supabase/configuration/initial-test-pricing.sql).
2. Keep the app configured with the existing **Paystack test secret** (`sk_test_...`). Do not paste the secret into SQL or chat. The database `active` flag makes the product available; it does not enforce Paystack Test Mode. SQL cannot inspect the app's environment key. Live transactions remain unapproved.
3. In the CruiseApply Supabase SQL Editor, paste and run this configuration file once. Do not rerun migrations 0001, 0002 or 0003.
4. Confirm the result sets: product `15000 / GHS / 90 / true`, seven approved country mappings, `249` selectable countries, `0` FX rows and `0` active product overrides.
5. Report that configuration succeeded so checkout testing can continue.

The transaction checks the existing product, currencies and worldwide country selection. It aborts if FX data or active product overrides already exist, rather than silently removing them. If any statement fails, the configuration transaction rolls back; share the error for diagnosis.

The SQL updates only the approved product and mappings. It neither edits immutable quotes/payments nor replaces any fulfillment function. No Paystack request is made by this SQL.

## Checkout result and remaining webhook test

The original GHS 150.00 test checkout is verified and fulfilled through the normal application endpoint and `fulfill_verified_payment()`. Exactly one voucher and notification exist, repeated verification is idempotent, and receipt/history access checks passed. See [the investigation report](PAYSTACK-E2E.md) for the distinction between the successful test applicant's reference and the unrelated unpaid dashboard reference.

For webhook delivery, Paystack needs a publicly reachable HTTPS endpoint at `/api/payments/webhook`; localhost alone cannot receive delivery. If no public endpoint is available at that step, stop and provide the exact deployment/tunnel and Paystack dashboard setup instructions before continuing. See [the existing architecture and setup notes](REGIONAL-PRICING.md).

The owner applied the configuration SQL. Checkout, normal server verification, fulfillment and receipt/history checks passed. Actual Paystack-delivered webhooks remain untested; Live Mode remains unapproved.

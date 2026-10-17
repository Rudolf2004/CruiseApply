# CruiseApply

Independent cruise career discovery and application support. The supplied homepage reference defines the visual identity. This repository is under implementation; see [the delivery record](docs/IMPLEMENTATION.md). It is not yet a production-ready recruitment platform.

## Stack and structure

Next.js App Router, TypeScript, Tailwind CSS, Supabase PostgreSQL/Auth/Storage, Paystack, React Hook Form, Zod and Lucide. npm is the package manager. Dependencies are pinned by the lockfile after installation.

- `src/app`: routes, layouts and shared styles
- `src/lib`: configuration, validation and server-only auth/database access
- `supabase/migrations`: reproducible database changes
- `supabase/seed.sql`: explicitly marked development data
- `public`: local image assets

## Local setup

Use Node.js 24 LTS and npm. On Windows with a restricted PowerShell execution policy, use `npm.cmd` in place of `npm`.

```sh
npm install
```

Copy `.env.example` to `.env.local` and fill in values locally. Never commit credentials.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | Exact app origin, e.g. `http://localhost:3000` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key; RLS remains mandatory |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Optional legacy fallback if no publishable key is set |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only database service role key |
| `PAYSTACK_SECRET_KEY` | Server-only Paystack test/live secret for one-time purchases and webhook signatures |
| `VOUCHER_ENCRYPTION_KEY` | 32-byte random hex key for voucher credential encryption; retain securely to recover existing PINs |
| `DEMO_MODE` | Explicit local sample mode; disabled in production |

Generate the encryption key locally with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Keep the value private.

```sh
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
```

## Supabase: required manual setup

1. Create a project at https://supabase.com/dashboard.
2. In project settings, copy the project URL and publishable key into the corresponding `.env.local` variables. The legacy anon key is also supported as a fallback. Put the service role key only in `SUPABASE_SERVICE_ROLE_KEY`; never prefix it with `NEXT_PUBLIC_`.
3. This project uses hosted Supabase without Docker. Migrations 0001, 0002 and 0003 are already applied; do not rerun them. Migration 0004 is also applied. See [application workflow verification and remaining dependencies](docs/APPLICATION-WORKFLOW.md).
4. Under Authentication → URL Configuration set Site URL to the app origin and add `/auth/callback` and `/reset-password` under that origin to allowed redirects. Use the production HTTPS origin on deployment.
5. Confirm that all public domain tables have RLS enabled and `application-documents` is private. No public storage policy is created.
6. Admin roles must be assigned through a trusted database administrator, never through signup metadata. Only promote a known user UUID.

The project owner confirmed migrations 0001–0003 were successfully applied. Do not reapply or recreate them. Subsequent schema changes must be separate migrations. The owner activated the voucher at GHS 150.00 for Test Mode only. See docs/PAYSTACK-E2E.md for the verified checkout, single-voucher fulfillment and receipt results. Actual webhook delivery remains outstanding.

## Paystack and deployment

The one-time payment handlers and screens are implemented. The current merchant charges GHS pesewas; regional display estimates never select Paystack's currency. Review the proposed configuration, configure only approved prices/rates, and complete the [Paystack test-mode setup and verification](docs/REGIONAL-PRICING.md) before accepting real payments. Set the publicly reachable HTTPS webhook URL to `/api/payments/webhook`; callback URLs are supplied server-side. Recurring charges and saved authorization codes are not used.

Deploy to a Node-compatible Next.js host after all implementation phases and required checks pass. Set environment variables in the host's secret manager, run migrations separately, and update Supabase allowed redirects to the production origin. Do not enable sample mode in production.

## Security boundaries

- Roles originate in protected profile records; authenticated users can update only their name and phone columns.
- Applicant read policies are scoped by `auth.uid()`; cross-row mutations are denied until narrowly scoped server operations are implemented.
- Voucher PIN hashes and encrypted PINs are excluded from authenticated API column grants.
- Private documents have no public bucket or object policy.
- Service credentials are imported only through a `server-only` module.
- Input, redirect, payment verification and webhook boundaries have unit tests. Hosted authentication/ownership, regional-pricing and fulfillment concurrency checks passed; complete Paystack checkout and upload integration checks remain required.

Technical references: [Next.js installation](https://nextjs.org/docs/app/getting-started/installation), [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [Paystack verification](https://paystack.com/docs/api/transaction/), [Paystack webhooks](https://paystack.com/docs/payments/webhooks/).

Managed screening: migrations 0004 and 0005 are applied. See [managed application E2E](docs/APPLICATION-E2E.md) for the original-voucher application test and remaining admin/webhook work.

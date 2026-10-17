# Hosted payment migration

Status: the owner has applied this migration (0002). Do not rerun it. The next manual change is documented in [regional pricing](REGIONAL-PRICING.md). Instructions below are retained for the migration record.

The foundation is already applied. Do not rerun it.

1. Open the CruiseApply project in Supabase, then SQL Editor.
2. Create a new query and paste the entire contents of `supabase/migrations/202609290002_payment_vouchers.sql`.
3. Run once. The file uses a transaction, so a failure rolls back its changes. If there is an error, retain the exact error for diagnosis rather than modifying or rerunning the foundation.
4. After success, run this read-only verification:

```sql
select
  to_regprocedure('public.fulfill_verified_payment(text,integer,text,text,text,text,text)') is not null as fulfillment_exists,
  to_regprocedure('public.redeem_verified_voucher(uuid,text,text,uuid)') is not null as redemption_exists,
  has_function_privilege('service_role', 'public.fulfill_verified_payment(text,integer,text,text,text,text,text)', 'execute') as server_can_fulfill,
  has_function_privilege('authenticated', 'public.fulfill_verified_payment(text,integer,text,text,text,text,text,text)', 'execute') as client_can_fulfill;
```

Expected values: `true`, `true`, `true`, `false`.

This migration does not create prices, vacancies, payments, or vouchers. It adds the server-only operations needed for the next implementation step. Live concurrency and rollback verification must follow application; local TypeScript tests do not execute PostgreSQL.

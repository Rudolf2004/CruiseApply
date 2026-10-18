-- Restore the approved regular price after the owner's GHS 1 trial.
-- REVIEW and run manually. No migration or payment mutation.
begin;
lock table public.voucher_types,public.voucher_price_overrides in share row exclusive mode;
do $$ begin
 if (select count(*) from public.voucher_types where code='application-access' and currency='GHS' and active)<>1 then
  raise exception 'Expected one active GHS application-access product';
 end if;
 if exists(select 1 from public.voucher_price_overrides o join public.voucher_types t on t.id=o.voucher_type_id where t.code='application-access' and o.active) then
  raise exception 'Review active overrides before restoring the base price';
 end if;
end; $$;
update public.voucher_types set amount=15000 where code='application-access';
commit;
select code,amount,currency,validity_days,active from public.voucher_types where code='application-access';
-- Expected: application-access | 15000 | GHS | 90 | true.
-- Existing 15-minute quotes and initialized provider links retain their snapshots.
-- Do not reuse GHS 1 checkout links for regular purchases. Request a fresh quote.

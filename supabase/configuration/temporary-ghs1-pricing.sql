-- REVIEW, then apply manually. GHS 1.00 = 100 pesewas.
-- Changes the active product's base price globally for NEW quotes.
-- Does not authorize Live Mode or change existing quotes/payments/vouchers.
-- Restore the approved GHS 150 base price after the controlled test.
begin;
lock table public.voucher_types, public.voucher_price_overrides in share row exclusive mode;
do $$
begin
 if (select count(*) from public.voucher_types where code='application-access' and currency='GHS' and active) <> 1 then
  raise exception 'Expected one active GHS application-access product';
 end if;
 if exists(select 1 from public.voucher_price_overrides o join public.voucher_types t on t.id=o.voucher_type_id where t.code='application-access' and o.active) then
  raise exception 'Active overrides exist: review before changing the base price';
 end if;
end; $$;
update public.voucher_types set amount=100 where code='application-access';
commit;
select code,amount,currency,validity_days,active from public.voucher_types where code='application-access';
-- Expected: application-access | 100 | GHS | 90 | true.
-- Existing unexpired quotes retain their snapshot; request a NEW quote after applying.

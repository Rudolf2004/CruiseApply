-- Approved initial TEST checkout configuration. REVIEW, then run manually.
-- Requires already-applied migrations 0001–0003. Does not rerun any migration.
-- The application must use PAYSTACK_SECRET_KEY=sk_test_... (never paste it here).
-- active=true enables product availability; SQL cannot inspect the app's secret
-- or select Paystack Test Mode. This is NOT authorization for live transactions.
begin;

lock table public.voucher_types, public.pricing_regions, public.pricing_countries,
  public.pricing_currencies, public.voucher_price_overrides, public.pricing_exchange_rates
  in share row exclusive mode;

do $$
begin
  if (select count(*) from public.voucher_types where code = 'application-access') <> 1 then
    raise exception 'Expected the existing application-access product from migration 0003';
  end if;
  if (select count(*) from public.pricing_currencies
      where code in ('GHS','NGN','USD','GBP','CAD','EUR') and minor_units = 2) <> 6 then
    raise exception 'Expected configured display currencies with two minor units';
  end if;
  if (select count(*) from public.pricing_countries) <> 249
    or exists(select 1 from public.pricing_countries where not active) then
    raise exception 'Expected all 249 countries available; review country configuration before proceeding';
  end if;
  if exists(select 1 from public.pricing_exchange_rates) then
    raise exception 'FX rates already exist; review them separately. This configuration requires GHS display fallback';
  end if;
  if exists(select 1 from public.voucher_price_overrides o
    join public.voucher_types t on t.id = o.voucher_type_id
    where t.code = 'application-access' and o.active) then
    raise exception 'Active price overrides exist; review them separately before applying the base-only configuration';
  end if;
end; $$;

insert into public.pricing_regions(code, name, display_currency, active) values
  ('ghana', 'Ghana', 'GHS', true),
  ('nigeria', 'Nigeria', 'NGN', true),
  ('united-states', 'United States', 'USD', true),
  ('united-kingdom', 'United Kingdom', 'GBP', true),
  ('canada', 'Canada', 'CAD', true),
  ('euro-display', 'Euro display countries', 'EUR', true)
on conflict(code) do update set
  name = excluded.name, display_currency = excluded.display_currency, active = excluded.active;

update public.pricing_countries as country
set region_id = region.id
from (values
  ('GH','ghana'), ('NG','nigeria'), ('US','united-states'),
  ('GB','united-kingdom'), ('CA','canada'),
  ('DE','euro-display'), ('FR','euro-display')
) as mapping(country_code, region_code)
join public.pricing_regions as region on region.code = mapping.region_code
where country.code = mapping.country_code;

update public.voucher_types
set name = 'CruiseApply Application Access', amount = 15000,
  currency = 'GHS', validity_days = 90, active = true
where code = 'application-access';

-- No FX insertion, price overrides, quote/payment changes, or function changes.
commit;

-- Read-only confirmation: product 15000/GHS/90/true; seven mappings;
-- 249 selectable countries; zero FX rows and zero active product overrides.
select code, name, amount, currency, validity_days, active
from public.voucher_types where code = 'application-access';

select c.code as country, r.code as region, r.display_currency
from public.pricing_countries c join public.pricing_regions r on r.id = c.region_id
where c.code in ('GH','NG','US','GB','CA','DE','FR') order by c.code;

select
  (select count(*) from public.pricing_countries where active) as selectable_countries,
  (select count(*) from public.pricing_exchange_rates) as fx_rows,
  (select count(*) from public.voucher_price_overrides o
   join public.voucher_types t on t.id = o.voucher_type_id
   where t.code = 'application-access' and o.active) as active_product_overrides;

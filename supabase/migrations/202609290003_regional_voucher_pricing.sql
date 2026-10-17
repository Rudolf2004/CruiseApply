-- Apply AFTER 0001 and 0002. Review and run manually; no price is invented here.
begin;

alter table public.voucher_types add column code text unique;
alter table public.voucher_types alter column amount drop not null;
alter table public.voucher_types add constraint active_voucher_requires_price check (not active or amount is not null);
insert into public.voucher_types(code, name, description, amount, currency, validity_days, active)
values('application-access', 'CruiseApply Application Access', 'Access to start one cruise career application.', null, 'GHS', 90, false);

create table public.pricing_currencies (
  code text primary key check (code ~ '^[A-Z]{3}$'),
  minor_units smallint not null check (minor_units between 0 and 4)
);
insert into public.pricing_currencies(code, minor_units) values
('GHS',2),('NGN',2),('USD',2),('GBP',2),('EUR',2),('CAD',2);
create table public.pricing_regions (
  id uuid primary key default gen_random_uuid(), code text not null unique,
  name text not null, display_currency text not null references public.pricing_currencies,
  active boolean not null default true
);
create table public.pricing_countries (
  code text primary key check (code ~ '^[A-Z]{2}$'),
  name text, region_id uuid references public.pricing_regions,
  active boolean not null default true
);
-- Country selection is worldwide. Unmapped countries use the GHS fallback.
insert into public.pricing_countries(code)
select unnest(string_to_array('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW', ' '));

create table public.voucher_price_overrides (
  id uuid primary key default gen_random_uuid(), voucher_type_id uuid not null references public.voucher_types,
  country_code text references public.pricing_countries, region_id uuid references public.pricing_regions,
  charge_amount integer not null check (charge_amount > 0), active boolean not null default true,
  check ((country_code is not null)::integer + (region_id is not null)::integer = 1)
);
create unique index voucher_country_price on public.voucher_price_overrides(voucher_type_id,country_code) where country_code is not null;
create unique index voucher_region_price on public.voucher_price_overrides(voucher_type_id,region_id) where region_id is not null;

create table public.pricing_exchange_rates (
  quote_currency text primary key references public.pricing_currencies,
  base_currency text not null default 'GHS' check (base_currency = 'GHS'),
  rate numeric(20,10) not null check (rate > 0 and rate <= 1000000),
  source text not null check (length(source) between 1 and 200),
  as_of timestamptz not null, valid_until timestamptz not null,
  check (valid_until > as_of), check (quote_currency <> 'GHS')
);

create table public.payment_quotes (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles,
  voucher_type_id uuid not null references public.voucher_types,
  product_name text not null, validity_days integer not null check(validity_days between 1 and 1095),
  country_code text not null references public.pricing_countries,
  region_code text, price_source text not null check(price_source in ('base','region','country')),
  charge_amount integer not null check(charge_amount > 0), charge_currency text not null check(charge_currency = 'GHS'),
  display_amount bigint not null check(display_amount between 1 and 9007199254740991),
  display_currency text not null references public.pricing_currencies,
  display_minor_units smallint not null check(display_minor_units between 0 and 4),
  exchange_rate numeric(20,10), exchange_rate_source text, exchange_rate_as_of timestamptz,
  created_at timestamptz not null default now(), expires_at timestamptz not null,
  check(expires_at > created_at)
);
create index payment_quotes_owner on public.payment_quotes(user_id,created_at desc);

-- Existing amount/currency remain the authoritative fields used by fulfillment.
-- Generated aliases make charge versus display explicit without conflicting values.
alter table public.payments
  add column charge_amount integer generated always as (amount) stored,
  add column charge_currency text generated always as (currency) stored,
  add column quote_id uuid unique references public.payment_quotes,
  add column product_name text,
  add column country_code text,
  add column region_code text,
  add column price_source text,
  add column display_amount bigint,
  add column display_currency text,
  add column display_minor_units smallint,
  add column exchange_rate numeric(20,10),
  add column exchange_rate_source text,
  add column exchange_rate_as_of timestamptz,
  add column checkout_url text;
alter table public.payments add constraint quoted_payment_has_snapshot check (
  quote_id is null or (
    currency = 'GHS' and product_name is not null and country_code is not null
    and price_source in ('base','region','country') and price_source is not null
    and display_amount is not null and display_amount between 1 and 9007199254740991
    and display_currency is not null and display_currency ~ '^[A-Z]{3}$'
    and display_minor_units is not null and display_minor_units between 0 and 4
    and (display_currency = 'GHS' or (exchange_rate is not null and exchange_rate > 0
      and exchange_rate_source is not null and exchange_rate_as_of is not null))
  )
);

create function public.quote_voucher_price(p_user_id uuid, p_type_id uuid, p_country_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  product public.voucher_types; country public.pricing_countries; region public.pricing_regions;
  fx public.pricing_exchange_rates; quote public.payment_quotes;
  charge integer; estimate bigint; display_code text := 'GHS'; decimals smallint := 2;
  source text := 'base'; override_amount integer; expires timestamptz := now() + interval '15 minutes';
begin
  select * into product from public.voucher_types where id = p_type_id and active;
  if not found or product.amount is null or product.currency <> 'GHS' then raise exception 'Voucher pricing unavailable'; end if;
  select * into country from public.pricing_countries where code = p_country_code and active;
  if not found then raise exception 'Country unavailable'; end if;
  select * into region from public.pricing_regions where id = country.region_id and active;
  charge := product.amount;
  if region.id is not null then
    select charge_amount into override_amount from public.voucher_price_overrides where voucher_type_id = product.id and region_id = region.id and active;
    if found then charge := override_amount; source := 'region'; end if;
  end if;
  select charge_amount into override_amount from public.voucher_price_overrides where voucher_type_id = product.id and country_code = country.code and active;
  if found then charge := override_amount; source := 'country'; end if;
  estimate := charge;
  if region.display_currency is not null and region.display_currency <> 'GHS' then
    select * into fx from public.pricing_exchange_rates where quote_currency = region.display_currency and as_of <= now() and valid_until > now();
    if found then
      select minor_units into decimals from public.pricing_currencies where code = fx.quote_currency;
      estimate := round(charge::numeric / 100 * fx.rate * power(10::numeric,decimals))::bigint;
      if estimate > 0 and estimate <= 9007199254740991 then
        display_code := fx.quote_currency; expires := least(expires,fx.valid_until);
      else estimate := charge; decimals := 2; end if;
    end if;
  end if;
  insert into public.payment_quotes(user_id,voucher_type_id,product_name,validity_days,country_code,region_code,price_source,
    charge_amount,charge_currency,display_amount,display_currency,display_minor_units,exchange_rate,exchange_rate_source,exchange_rate_as_of,expires_at)
  values(p_user_id,product.id,product.name,product.validity_days,country.code,region.code,source,
    charge,'GHS',estimate,display_code,decimals,
    case when display_code <> 'GHS' then fx.rate else null end,
    case when display_code <> 'GHS' then fx.source else null end,
    case when display_code <> 'GHS' then fx.as_of else null end,expires)
  returning * into quote;
  return to_jsonb(quote);
end; $$;

create function public.create_payment_from_quote(p_user_id uuid, p_quote_id uuid, p_reference text, p_job_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare quote public.payment_quotes; payment public.payments; email text; job public.jobs;
begin
  select * into quote from public.payment_quotes where id = p_quote_id and user_id = p_user_id for update;
  if not found then raise exception 'Quote unavailable'; end if;
  select * into payment from public.payments where quote_id = quote.id;
  if found then
    if payment.job_id is distinct from p_job_id then raise exception 'Quote already used for another selection'; end if;
    if quote.expires_at <= now() and payment.checkout_url is null and payment.status in ('initialized','pending') then
      raise exception 'Quote expired before checkout was initialized';
    end if;
    return to_jsonb(payment);
  end if;
  if quote.expires_at <= now() then raise exception 'Quote expired'; end if;
  if not exists(select 1 from public.voucher_types where id = quote.voucher_type_id and active) then raise exception 'Voucher unavailable'; end if;
  if p_job_id is not null then
    select * into job from public.jobs where id = p_job_id for share;
    if not found or job.status <> 'published' or job.sample or job.application_deadline <= now() then raise exception 'Job unavailable'; end if;
  end if;
  select u.email into email from auth.users u where u.id = p_user_id;
  if email is null then raise exception 'Customer unavailable'; end if;
  insert into public.payments(user_id,reference,voucher_type_id,job_id,amount,currency,validity_days,customer_email,
    quote_id,product_name,country_code,region_code,price_source,display_amount,display_currency,display_minor_units,exchange_rate,exchange_rate_source,exchange_rate_as_of)
  values(p_user_id,p_reference,quote.voucher_type_id,p_job_id,quote.charge_amount,quote.charge_currency,quote.validity_days,email,
    quote.id,quote.product_name,quote.country_code,quote.region_code,quote.price_source,quote.display_amount,quote.display_currency,quote.display_minor_units,quote.exchange_rate,quote.exchange_rate_source,quote.exchange_rate_as_of)
  returning * into payment;
  return to_jsonb(payment);
end; $$;

-- Freeze financial history. Status/provider confirmation/checkout URL may change;
-- ownership, pricing and customer verification fields may not.
create function public.protect_payment_snapshot() returns trigger language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - array['status','provider_id','paid_at','checkout_url','charge_amount','charge_currency'])
    is distinct from (to_jsonb(old) - array['status','provider_id','paid_at','checkout_url','charge_amount','charge_currency']) then
    raise exception 'Payment pricing snapshots are immutable';
  end if;
  return new;
end; $$;
create trigger immutable_payment_snapshot before update on public.payments for each row execute function public.protect_payment_snapshot();
create function public.protect_payment_quote() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'Payment quotes are immutable; request a new quote'; end; $$;
create trigger immutable_payment_quote before update on public.payment_quotes for each row execute function public.protect_payment_quote();

do $$ declare t text; begin
  foreach t in array array['pricing_currencies','pricing_regions','pricing_countries','voucher_price_overrides','pricing_exchange_rates','payment_quotes'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
  end loop;
end $$;
grant select on public.pricing_countries to authenticated;
create policy country_selection on public.pricing_countries for select to authenticated using(active);
revoke all on function public.quote_voucher_price(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.create_payment_from_quote(uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.protect_payment_snapshot() from public,anon,authenticated;
revoke all on function public.protect_payment_quote() from public,anon,authenticated;
grant execute on function public.quote_voucher_price(uuid,uuid,text) to service_role;
grant execute on function public.create_payment_from_quote(uuid,uuid,text,uuid) to service_role;
commit;

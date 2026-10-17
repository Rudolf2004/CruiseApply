-- REVIEW ONLY: apply after 0015. No configuration values are inserted here.
-- No payment/auth cutover, FX seed, price change or public contact is invented.
begin;
create table public.pricing_configuration_commands (
 request_id uuid primary key, actor_id uuid not null references public.profiles,
 entity text not null, record_key text not null, payload jsonb not null,
 created_at timestamptz not null default now()
);
alter table public.pricing_configuration_commands enable row level security;
revoke all on public.pricing_configuration_commands from public,anon,authenticated,service_role;
grant select on public.pricing_configuration_commands to authenticated;
grant select,insert,delete on public.pricing_configuration_commands to service_role;
create policy pricing_configuration_staff_read on public.pricing_configuration_commands for select to authenticated using(public.is_admin());
create index pricing_configuration_actor on public.pricing_configuration_commands(actor_id);

create function public.save_pricing_configuration(p_request_id uuid,p_actor_id uuid,p_entity text,p_key text,p_expected jsonb,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare staff public.profiles; prior public.pricing_configuration_commands; current_row jsonb; payload jsonb;
begin
 select * into staff from public.profiles where id=p_actor_id for share;
 if not found or staff.role<>'super_admin' then raise exception 'Super administrator required'; end if;
 if p_request_id is null or p_entity is null or p_entity not in ('region','country','exchange','override','contact')
  or p_key is null or length(p_key) not between 1 and 100 or jsonb_typeof(p_data) is distinct from 'object'
  or length(p_data::text)>10000 or (p_expected is not null and (jsonb_typeof(p_expected)<>'object' or length(p_expected::text)>10000)) then raise exception 'Invalid configuration'; end if;
 payload:=jsonb_build_object('expected',p_expected,'data',p_data);
 perform pg_advisory_xact_lock(hashtextextended('pricing-command:'||p_request_id::text,0));
 select * into prior from public.pricing_configuration_commands where request_id=p_request_id;
 if found then
  if prior.actor_id<>p_actor_id or prior.entity<>p_entity or prior.record_key<>p_key or prior.payload is distinct from payload then raise exception 'Request conflict'; end if;
  return jsonb_build_object('saved',true,'replayed',true);
 end if;
 -- Serializes creation as well as existing-row edits. Expected complete rows also
 -- detect changes made outside these controls; there is no last-write-wins update.
 perform pg_advisory_xact_lock(hashtextextended('pricing-record:'||p_entity||':'||p_key,0));
 case p_entity
 when 'region' then select to_jsonb(t) into current_row from public.pricing_regions t where id=p_key::uuid for update;
 when 'country' then select to_jsonb(t) into current_row from public.pricing_countries t where code=p_key for update;
 when 'exchange' then select to_jsonb(t) into current_row from public.pricing_exchange_rates t where quote_currency=p_key for update;
 when 'override' then select to_jsonb(t) into current_row from public.voucher_price_overrides t where id=p_key::uuid for update;
 when 'contact' then select to_jsonb(t) into current_row from public.platform_settings t where key=p_key for update;
 end case;
 if current_row is distinct from p_expected then raise exception 'Configuration changed'; end if;
 case p_entity
 when 'region' then
  if p_data-array['code','name','display_currency','active']<>'{}'::jsonb
   or coalesce(p_data->>'code','')!~'^[a-z0-9][a-z0-9-]{0,79}$'
   or length(btrim(coalesce(p_data->>'name',''))) not between 2 and 200
   or coalesce(p_data->>'display_currency','')!~'^[A-Z]{3}$'
   or jsonb_typeof(p_data->'active') is distinct from 'boolean' then raise exception 'Invalid region'; end if;
  insert into public.pricing_regions(id,code,name,display_currency,active) values(p_key::uuid,p_data->>'code',btrim(p_data->>'name'),p_data->>'display_currency',(p_data->>'active')::boolean)
   on conflict(id) do update set code=excluded.code,name=excluded.name,display_currency=excluded.display_currency,active=excluded.active;
 when 'country' then
  if current_row is null or p_data-array['region_id']<>'{}'::jsonb or not p_data?'region_id' then raise exception 'Invalid country mapping'; end if;
  update public.pricing_countries set region_id=(p_data->>'region_id')::uuid where code=p_key;
 when 'exchange' then
  if p_key='GHS' or p_key!~'^[A-Z]{3}$' or p_data-array['rate','source','as_of','valid_until']<>'{}'::jsonb
   or coalesce(p_data->>'rate','')!~'^[0-9]{1,7}(\.[0-9]{1,10})?$'
   or (p_data->>'rate')::numeric not between 0.0000000001 and 1000000
   or length(btrim(coalesce(p_data->>'source',''))) not between 1 and 200
   or p_data->>'as_of' is null or p_data->>'valid_until' is null
   or not isfinite((p_data->>'as_of')::timestamptz) or not isfinite((p_data->>'valid_until')::timestamptz)
   or (p_data->>'valid_until')::timestamptz <= (p_data->>'as_of')::timestamptz then raise exception 'Invalid exchange metadata'; end if;
  insert into public.pricing_exchange_rates(quote_currency,rate,source,as_of,valid_until)
   values(p_key,(p_data->>'rate')::numeric,btrim(p_data->>'source'),(p_data->>'as_of')::timestamptz,(p_data->>'valid_until')::timestamptz)
   on conflict(quote_currency) do update set rate=excluded.rate,source=excluded.source,as_of=excluded.as_of,valid_until=excluded.valid_until;
 when 'override' then
  if p_data-array['voucher_type_id','country_code','region_id','charge_amount','active']<>'{}'::jsonb
   or p_data->>'voucher_type_id' is null or ((p_data->>'country_code' is not null)=(p_data->>'region_id' is not null))
   or coalesce(p_data->>'charge_amount','')!~'^[0-9]{1,9}$' or (p_data->>'charge_amount')::integer<1
   or jsonb_typeof(p_data->'active') is distinct from 'boolean' then raise exception 'Invalid price override'; end if;
  if not exists(select 1 from public.voucher_types where id=(p_data->>'voucher_type_id')::uuid and currency='GHS') then raise exception 'GHS product required'; end if;
  insert into public.voucher_price_overrides(id,voucher_type_id,country_code,region_id,charge_amount,active)
   values(p_key::uuid,(p_data->>'voucher_type_id')::uuid,p_data->>'country_code',(p_data->>'region_id')::uuid,(p_data->>'charge_amount')::integer,(p_data->>'active')::boolean)
   on conflict(id) do update set voucher_type_id=excluded.voucher_type_id,country_code=excluded.country_code,region_id=excluded.region_id,charge_amount=excluded.charge_amount,active=excluded.active;
 when 'contact' then
  if p_key not in ('support_email','support_phone') or p_data-array['value']<>'{}'::jsonb
   or jsonb_typeof(p_data->'value') is distinct from 'string'
   or length(btrim(p_data->>'value')) not between 3 and 254 or p_data->>'value' ~ '[\r\n]'
   or (p_key='support_email' and p_data->>'value'!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
   or (p_key='support_phone' and p_data->>'value'!~'^[+0-9 ()-]{3,40}$') then raise exception 'Invalid public support contact'; end if;
  insert into public.platform_settings(key,value,public) values(p_key,to_jsonb(btrim(p_data->>'value')),true)
   on conflict(key) do update set value=excluded.value,public=true,updated_at=clock_timestamp();
 end case;
 insert into public.pricing_configuration_commands(request_id,actor_id,entity,record_key,payload) values(p_request_id,p_actor_id,p_entity,p_key,payload);
 insert into public.audit_logs(actor_id,action,target_type,target_id,metadata) values(p_actor_id,'pricing_configuration_saved',p_entity,p_key,jsonb_build_object('request_id',p_request_id));
 return jsonb_build_object('saved',true,'replayed',false);
end; $$;

create function public.record_staff_export(p_actor_id uuid,p_kind text,p_page integer,p_count integer)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.profiles where id=p_actor_id and role in ('admin','super_admin') for share;
 if not found then raise exception 'Administrator required'; end if;
 if p_kind is null or p_kind not in ('payments','vouchers','opportunities','accounts','audit','pricing','regions','countries','exchange','overrides')
   or p_page is null or p_page not between 1 and 10000 or p_count is null or p_count not between 0 and 25 then raise exception 'Invalid export'; end if;
 insert into public.audit_logs(actor_id,action,target_type,target_id,metadata) values(p_actor_id,'staff_export_prepared',p_kind,'page',jsonb_build_object('page',p_page,'rows',p_count));
end; $$;
revoke all on function public.save_pricing_configuration(uuid,uuid,text,text,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.record_staff_export(uuid,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.save_pricing_configuration(uuid,uuid,text,text,jsonb,jsonb) to service_role;
grant execute on function public.record_staff_export(uuid,text,integer,integer) to service_role;
commit;

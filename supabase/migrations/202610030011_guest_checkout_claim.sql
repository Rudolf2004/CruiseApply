-- REVIEW ONLY. Guest ownership, verified fulfillment and one-time initial claim.
-- Apply manually after 0010. No backfill, business-row changes, rollout or Paystack call.
begin;
do $$ declare t text; begin
  foreach t in array array['payment_quotes','payments','vouchers','applicants','applications','application_documents','notifications'] loop
    execute format('alter table public.%I alter column user_id drop not null',t);
  end loop;
end; $$;
-- XOR ownership and immutable-owner guards remain in force. Legacy rows cannot
-- be reassigned. New principal payments/quotes must belong to a guest checkout.
alter table public.payment_quotes add constraint principal_quote_checkout check(applicant_id is null or guest_checkout_id is not null);
alter table public.payments add constraint principal_payment_checkout check(applicant_id is null or guest_checkout_id is not null);
create unique index one_guest_payment on public.payments(guest_checkout_id) where guest_checkout_id is not null;
create unique index one_principal_voucher on public.vouchers(applicant_id) where applicant_id is not null;
create unique index one_principal_application on public.applications(applicant_id) where applicant_id is not null;
alter table public.vouchers alter column pin_hash drop not null;
alter table public.vouchers alter column pin_encrypted drop not null;
alter table public.vouchers add constraint voucher_credential_owner check(
  (user_id is not null and pin_hash is not null and pin_encrypted is not null)
  or (applicant_id is not null and pin_hash is null and pin_encrypted is null));

create function public.guard_principal_business_chain() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.applicant_id is null then return new; end if;
  if tg_table_name='vouchers' then
    if not exists(select 1 from public.payments p where p.id=new.payment_id and p.applicant_id=new.applicant_id and p.user_id is null and p.paid_at is not null and p.status in ('successful','refunded')) then raise exception 'Voucher owner mismatch'; end if;
  elsif tg_table_name='applications' then
    if not exists(select 1 from public.vouchers v where v.id=new.voucher_id and v.applicant_id=new.applicant_id and v.user_id is null) then raise exception 'Application owner mismatch'; end if;
  elsif tg_table_name='application_documents' then
    if not exists(select 1 from public.applications a where a.id=new.application_id and a.applicant_id=new.applicant_id and a.user_id is null) then raise exception 'Document owner mismatch'; end if;
  end if;
  return new;
end; $$;
create trigger principal_voucher_chain before insert on public.vouchers for each row execute function public.guard_principal_business_chain();
create trigger principal_application_chain before insert on public.applications for each row execute function public.guard_principal_business_chain();
create trigger principal_document_chain before insert on public.application_documents for each row execute function public.guard_principal_business_chain();

create function public.begin_guest_checkout(p_capability_hash text,p_email text,p_name text,p_country_code text)
returns uuid language plpgsql security definer set search_path='' as $$
declare principal uuid; checkout uuid;
begin
  if p_capability_hash is null or p_capability_hash !~ '^[a-f0-9]{64}$' or p_email is null or length(btrim(p_email)) not between 3 and 254
    or p_email ~ '[[:space:]]' or p_name is null or length(btrim(p_name)) not between 1 and 200
    or not exists(select 1 from public.pricing_countries where code=p_country_code and active) then raise exception 'Invalid checkout'; end if;
  insert into public.applicant_principals(display_name) values(btrim(p_name)) returning id into principal;
  insert into public.guest_checkouts(applicant_id,capability_hash,contact_email,contact_name,country_code,expires_at)
    values(principal,p_capability_hash,lower(btrim(p_email)),btrim(p_name),p_country_code,now()+interval '24 hours') returning id into checkout;
  return checkout;
end; $$;

create function public.lock_guest_checkout(p_capability_hash text)
returns public.guest_checkouts language plpgsql security definer set search_path='' as $$
declare checkout public.guest_checkouts;
begin
  if p_capability_hash is null or p_capability_hash !~ '^[a-f0-9]{64}$' then raise exception 'Checkout unavailable' using errcode='28000'; end if;
  select * into checkout from public.guest_checkouts where capability_hash=p_capability_hash for no key update;
  if not found or checkout.revoked_at is not null or checkout.expires_at<=clock_timestamp() then raise exception 'Checkout unavailable' using errcode='28000'; end if;
  perform 1 from public.applicant_principals where id=checkout.applicant_id and disabled_at is null for share;
  if not found then raise exception 'Checkout unavailable' using errcode='28000'; end if;
  return checkout;
end; $$;

create function public.create_guest_quote(p_capability_hash text, p_type_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  checkout public.guest_checkouts; p_country_code text; product public.voucher_types; country public.pricing_countries; region public.pricing_regions;
  fx public.pricing_exchange_rates; quote public.payment_quotes;
  charge integer; estimate bigint; display_code text := 'GHS'; decimals smallint := 2;
  source text := 'base'; override_amount integer; expires timestamptz := now() + interval '15 minutes';
begin
  checkout := public.lock_guest_checkout(p_capability_hash); p_country_code := checkout.country_code;
  if exists(select 1 from public.payments where guest_checkout_id=checkout.id) then raise exception 'Checkout already initialized'; end if;
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
  insert into public.payment_quotes(applicant_id,guest_checkout_id,voucher_type_id,product_name,validity_days,country_code,region_code,price_source,
    charge_amount,charge_currency,display_amount,display_currency,display_minor_units,exchange_rate,exchange_rate_source,exchange_rate_as_of,expires_at)
  values(checkout.applicant_id,checkout.id,product.id,product.name,product.validity_days,country.code,region.code,source,
    charge,'GHS',estimate,display_code,decimals,
    case when display_code <> 'GHS' then fx.rate else null end,
    case when display_code <> 'GHS' then fx.source else null end,
    case when display_code <> 'GHS' then fx.as_of else null end,expires)
  returning * into quote;
  return to_jsonb(quote);
end; $$;

create function public.create_guest_payment(p_capability_hash text,p_quote_id uuid,p_reference text,p_job_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare checkout public.guest_checkouts; quote public.payment_quotes; payment public.payments;
begin
  checkout := public.lock_guest_checkout(p_capability_hash);
  select * into payment from public.payments where guest_checkout_id=checkout.id;
  if found then
    if payment.quote_id is distinct from p_quote_id or payment.job_id is distinct from p_job_id then raise exception 'Checkout already initialized'; end if;
    return to_jsonb(payment);
  end if;
  select * into quote from public.payment_quotes where id=p_quote_id and applicant_id=checkout.applicant_id and guest_checkout_id=checkout.id for share;
  if not found or quote.expires_at<=clock_timestamp() or not exists(select 1 from public.voucher_types where id=quote.voucher_type_id and active) then raise exception 'Quote unavailable'; end if;
  if p_reference is null or p_reference !~ '^CA-[a-f0-9-]{36}$' then raise exception 'Invalid reference'; end if;
  if p_job_id is not null and not exists(select 1 from public.jobs where id=p_job_id and status='published' and opportunity_type='managed' and not sample and (application_deadline is null or application_deadline>now())) then raise exception 'Opportunity unavailable'; end if;
  insert into public.payments(applicant_id,guest_checkout_id,reference,voucher_type_id,job_id,amount,currency,validity_days,customer_email,
    quote_id,product_name,country_code,region_code,price_source,display_amount,display_currency,display_minor_units,exchange_rate,exchange_rate_source,exchange_rate_as_of)
  values(checkout.applicant_id,checkout.id,p_reference,quote.voucher_type_id,p_job_id,quote.charge_amount,quote.charge_currency,quote.validity_days,checkout.contact_email,
    quote.id,quote.product_name,quote.country_code,quote.region_code,quote.price_source,quote.display_amount,quote.display_currency,quote.display_minor_units,quote.exchange_rate,quote.exchange_rate_source,quote.exchange_rate_as_of)
  returning * into payment;
  return to_jsonb(payment);
end; $$;

create function public.get_guest_checkout(p_capability_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare checkout public.guest_checkouts; result jsonb;
begin
  checkout:=public.lock_guest_checkout(p_capability_hash);
  select jsonb_build_object('reference',p.reference,'status',p.status,'charge_amount',p.amount,'charge_currency',p.currency,
    'product_name',p.product_name,'paid_at',p.paid_at,'claim_available',a.credential_state='pending_delivery' and d.consumed_at is null and d.revoked_at is null and d.expires_at>now() and p.status='successful' and v.status='unused')
  into result from public.payments p left join public.vouchers v on v.payment_id=p.id
    left join public.voucher_access a on a.voucher_id=v.id left join public.voucher_credential_deliveries d on d.voucher_access_id=a.id
    where p.guest_checkout_id=checkout.id;
  return jsonb_build_object('checkout_id',checkout.id,'payment',result);
end; $$;

create or replace function public.fulfill_verified_payment(
  p_reference text, p_amount integer, p_currency text, p_email text,
  p_provider_id text, p_pin_hash text, p_pin_encrypted text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare payment public.payments; voucher_id uuid; access_id uuid; checkout public.guest_checkouts; notice_id uuid;
begin
  select * into payment from public.payments where reference = p_reference for update;
  if not found then raise exception 'Payment not found'; end if;
  if payment.provider <> 'paystack' or payment.amount is distinct from p_amount
    or payment.currency is distinct from p_currency
    or lower(payment.customer_email) is distinct from lower(p_email)
    or coalesce(p_provider_id, '') = '' then raise exception 'Payment verification mismatch'; end if;
  if payment.status = 'refunded' then raise exception 'Payment refunded'; end if;
  select id into voucher_id from public.vouchers where payment_id = payment.id;
  if found then
    if payment.status <> 'successful' or payment.provider_id is distinct from p_provider_id then
      raise exception 'Inconsistent payment state';
    end if;
    return voucher_id;
  end if;
  if payment.applicant_id is not null then
    select * into checkout from public.guest_checkouts where id=payment.guest_checkout_id and applicant_id=payment.applicant_id;
    if not found then raise exception 'Checkout owner mismatch'; end if;
    if p_pin_hash is not null or p_pin_encrypted is not null then raise exception 'Guest credentials must be claimed separately'; end if;
    update public.payments set status='successful',provider_id=p_provider_id,paid_at=now() where id=payment.id;
    insert into public.vouchers(applicant_id,payment_id,voucher_type_id,job_id,expires_at)
      values(payment.applicant_id,payment.id,payment.voucher_type_id,payment.job_id,now()+make_interval(days=>payment.validity_days)) returning id into voucher_id;
    insert into public.voucher_access(voucher_id,applicant_id,credential_state) values(voucher_id,payment.applicant_id,'pending_delivery') returning id into access_id;
    insert into public.voucher_contacts(voucher_access_id,email) values(access_id,checkout.contact_email);
    insert into public.voucher_credential_deliveries(voucher_access_id,guest_checkout_id,capability_hash,expires_at)
      values(access_id,checkout.id,checkout.capability_hash,greatest(checkout.expires_at,now()+interval '1 hour'));
    insert into public.notifications(applicant_id,title,body,href) values(payment.applicant_id,'Voucher ready','Your verified voucher is ready. Claim your applicant access securely.','/applicant/payment') returning id into notice_id;
    insert into public.applicant_notification_links(notification_id,voucher_access_id,payment_id) values(notice_id,access_id,payment.id);
    return voucher_id;
  end if;
  if coalesce(p_pin_hash, '') = '' or coalesce(p_pin_encrypted, '') = '' then raise exception 'Missing voucher credentials'; end if;
  update public.payments set status = 'successful', provider_id = p_provider_id, paid_at = now() where id = payment.id;
  insert into public.vouchers(user_id, payment_id, voucher_type_id, job_id, pin_hash, pin_encrypted, expires_at)
  values(payment.user_id, payment.id, payment.voucher_type_id, payment.job_id, p_pin_hash, p_pin_encrypted,
    now() + make_interval(days => payment.validity_days)) returning id into voucher_id;
  insert into public.notifications(user_id, title, body, href)
  values(payment.user_id, 'Voucher ready', 'Your payment was verified and your voucher is ready.', '/dashboard/vouchers');
  return voucher_id;
end; $$;

create function public.claim_guest_voucher(p_capability_hash text,p_pin_hash text,p_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare checkout public.guest_checkouts; payment public.payments; voucher public.vouchers;
  access public.voucher_access; delivery public.voucher_credential_deliveries; session public.applicant_sessions; at_time timestamptz;
begin
  if p_pin_hash is null or p_pin_hash !~ '^s1:[a-f0-9]{32}:[a-f0-9]{64}$' or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid credential material'; end if;
  checkout:=public.lock_guest_checkout(p_capability_hash);
  select * into payment from public.payments where guest_checkout_id=checkout.id for share;
  if not found or payment.status<>'successful' or payment.paid_at is null then raise exception 'Verified purchase unavailable'; end if;
  select * into voucher from public.vouchers where payment_id=payment.id and applicant_id=checkout.applicant_id for update;
  if not found or voucher.status<>'unused' or voucher.expires_at<=clock_timestamp() then raise exception 'Voucher unavailable'; end if;
  select * into access from public.voucher_access where voucher_id=voucher.id for update;
  if not found or access.credential_state<>'pending_delivery' or access.revoked_at is not null or access.suspended_at is not null then raise exception 'Credentials already claimed or unavailable'; end if;
  perform 1 from public.applicant_principals where id=access.applicant_id and disabled_at is null for share;
  if not found then raise exception 'Access unavailable'; end if;
  select * into delivery from public.voucher_credential_deliveries where voucher_access_id=access.id and guest_checkout_id=checkout.id and capability_hash=p_capability_hash for update;
  if not found or delivery.consumed_at is not null or delivery.revoked_at is not null or delivery.expires_at<=clock_timestamp() then raise exception 'Credentials already claimed or unavailable'; end if;
  at_time:=clock_timestamp();
  update public.voucher_access set credential_state='current',pin_hash=p_pin_hash,credential_version=1,credential_rotated_at=at_time where id=access.id;
  update public.voucher_credential_deliveries set consumed_at=at_time where id=delivery.id;
  insert into public.applicant_sessions(voucher_access_id,token_hash,credential_version,created_at,last_seen_at,idle_expires_at,absolute_expires_at)
    values(access.id,p_token_hash,1,at_time,at_time,at_time+interval '168 hours',at_time+interval '720 hours') returning * into session;
  insert into public.audit_logs(actor_applicant_id,action,target_type,target_id) values(access.applicant_id,'voucher_credentials_claimed','voucher_access',access.id::text);
  return jsonb_build_object('serial',voucher.serial,'idle_expires_at',session.idle_expires_at,'absolute_expires_at',session.absolute_expires_at);
end; $$;

create function public.save_application_draft_principal(p_applicant_id uuid, p_application_id uuid, p_revision integer, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.applications; item jsonb; ordinal integer;
begin
  select * into a from public.applications where id = p_application_id and applicant_id = p_applicant_id for update;
  if not found then raise exception 'Application unavailable'; end if;
  if a.status <> 'draft' then raise exception 'Application is read only'; end if;
  if p_revision is distinct from a.revision then raise exception 'Revision conflict'; end if;
  if jsonb_typeof(p_data) is distinct from 'object'
    or jsonb_typeof(p_data->'personal') is distinct from 'object'
    or jsonb_typeof(p_data->'identification') is distinct from 'object'
    or jsonb_typeof(p_data->'education') is distinct from 'array'
    or jsonb_typeof(p_data->'experience') is distinct from 'array'
    or jsonb_typeof(p_data->'answers') is distinct from 'object'
    or octet_length(p_data::text) > 65536 then raise exception 'Invalid draft'; end if;
  if jsonb_array_length(p_data->'education') > 20 or jsonb_array_length(p_data->'experience') > 30 then
    raise exception 'Too many records'; end if;
  update public.applications set personal = p_data->'personal', identification = p_data->'identification',
    revision = revision + 1, updated_at = clock_timestamp() where id = a.id returning * into a;
  delete from public.application_education where application_id = a.id;
  ordinal := 0;
  for item in select value from jsonb_array_elements(p_data->'education') loop
    insert into public.application_education(application_id,institution,qualification,field,country,start_date,completion_date,sort_order)
    values(a.id,item->>'institution',item->>'qualification',item->>'field',item->>'country',
      nullif(item->>'start_date','')::date,nullif(item->>'completion_date','')::date,ordinal);
    ordinal := ordinal + 1;
  end loop;
  delete from public.application_experience where application_id = a.id;
  ordinal := 0;
  for item in select value from jsonb_array_elements(p_data->'experience') loop
    insert into public.application_experience(application_id,employer,position,location,start_date,end_date,responsibilities,sort_order)
    values(a.id,item->>'employer',item->>'position',item->>'location',nullif(item->>'start_date','')::date,
      nullif(item->>'end_date','')::date,item->>'responsibilities',ordinal);
    ordinal := ordinal + 1;
  end loop;
  delete from public.application_answers where application_id = a.id;
  insert into public.application_answers(application_id,question_id,answer)
    select a.id,key,value from jsonb_each_text(p_data->'answers');
  return jsonb_build_object('revision',a.revision,'updatedAt',a.updated_at);
end; $$;

create function public.register_application_document_principal(p_applicant_id uuid, p_application_id uuid, p_revision integer,
  p_id uuid, p_kind text, p_name text, p_path text, p_mime text, p_size integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.applications;
begin
  select * into a from public.applications where id = p_application_id and applicant_id = p_applicant_id for update;
  if not found then raise exception 'Application unavailable'; end if;
  if a.status <> 'draft' then raise exception 'Application is read only'; end if;
  if p_revision is distinct from a.revision then raise exception 'Revision conflict'; end if;
  if p_kind is null or p_kind not in ('cv','passport','certificate','photo','supporting')
    or coalesce(length(p_name),0) not between 1 and 200
    or p_path is distinct from (p_applicant_id::text || '/' || a.id::text || '/' || p_id::text)
    then raise exception 'Invalid document'; end if;
  if (select count(*) from public.application_documents where application_id = a.id) >= 20 then
    raise exception 'Document limit reached'; end if;
  if not exists(select 1 from storage.objects where bucket_id = 'application-documents' and name = p_path)
    then raise exception 'Uploaded object missing'; end if;
  insert into public.application_documents(id,application_id,applicant_id,kind,name,storage_path,mime_type,size_bytes)
    values(p_id,a.id,p_applicant_id,p_kind,p_name,p_path,p_mime,p_size);
  update public.applications set revision = revision + 1, updated_at = clock_timestamp() where id = a.id returning * into a;
  return jsonb_build_object('revision',a.revision,'updatedAt',a.updated_at,'documentId',p_id);
end; $$;

create function public.remove_application_document_principal(p_applicant_id uuid, p_application_id uuid, p_revision integer, p_document_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.applications; path text;
begin
  select * into a from public.applications where id = p_application_id and applicant_id = p_applicant_id for update;
  if not found then raise exception 'Application unavailable'; end if;
  if a.status <> 'draft' then raise exception 'Application is read only'; end if;
  if p_revision is distinct from a.revision then raise exception 'Revision conflict'; end if;
  delete from public.application_documents where id = p_document_id and application_id = a.id and applicant_id = p_applicant_id
    returning storage_path into path;
  if not found then raise exception 'Document unavailable'; end if;
  update public.applications set revision = revision + 1, updated_at = clock_timestamp() where id = a.id returning * into a;
  return jsonb_build_object('revision',a.revision,'updatedAt',a.updated_at,'storagePath',path);
end; $$;

create function public.submit_application_principal(p_applicant_id uuid, p_application_id uuid, p_revision integer, p_declaration boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.applications; j public.jobs; q jsonb; k text; dob date;
begin
  select * into a from public.applications where id = p_application_id and applicant_id = p_applicant_id for update;
  if not found then raise exception 'Application unavailable'; end if;
  if p_declaration is distinct from true then raise exception 'Declaration required'; end if;
  if a.submitted_at is not null then
    return jsonb_build_object('reference',a.reference,'submittedAt',a.submitted_at); end if;
  if a.status <> 'draft' then raise exception 'Application is read only'; end if;
  if p_revision is distinct from a.revision then raise exception 'Revision conflict'; end if;
  select * into j from public.jobs where id = a.job_id for share;
  if not found or j.status <> 'published' or j.sample or j.application_deadline <= now()
    then raise exception 'Vacancy is no longer open'; end if;
  if not exists(select 1 from public.vouchers v where v.id = a.voucher_id and v.applicant_id = p_applicant_id
    and v.job_id = a.job_id and v.status = 'used') then raise exception 'Voucher unavailable'; end if;
  foreach k in array array['first_name','surname','date_of_birth','nationality','country_of_residence','email','phone','address'] loop
    if coalesce(length(btrim(a.personal->>k)),0) = 0 then raise exception 'Complete personal information'; end if;
  end loop;
  dob := (a.personal->>'date_of_birth')::date;
  if dob >= current_date or (j.minimum_age is not null and dob > (current_date - make_interval(years => j.minimum_age))::date)
    then raise exception 'Date of birth does not meet vacancy requirements'; end if;
  if jsonb_typeof(j.questions) is distinct from 'array' then raise exception 'Invalid vacancy question configuration'; end if;
  for q in select value from jsonb_array_elements(j.questions) loop
    if coalesce((q->>'required')::boolean,false) and not exists(
      select 1 from public.application_answers where application_id = a.id and question_id = q->>'id' and length(btrim(answer)) > 0)
      then raise exception 'Answer required vacancy questions'; end if;
  end loop;
  foreach k in array j.required_documents loop
    if not exists(select 1 from public.application_documents where application_id = a.id and kind = k)
      then raise exception 'Upload required documents'; end if;
  end loop;
  update public.applications set status = 'submitted', declaration_at = now(), submitted_at = now(),
    revision = revision + 1, updated_at = clock_timestamp() where id = a.id returning * into a;
  insert into public.application_status_history(application_id,status,message,actor_applicant_id)
    values(a.id,'submitted','Application submitted with applicant declaration.',p_applicant_id);
  insert into public.notifications(applicant_id,title,body,href)
    values(p_applicant_id,'Application submitted','Your application ' || a.reference || ' has been received.','/dashboard/applications/' || a.id::text);
  insert into public.audit_logs(actor_applicant_id,action,target_type,target_id)
    values(p_applicant_id,'application_submitted','applications',a.id::text);
  return jsonb_build_object('reference',a.reference,'submittedAt',a.submitted_at);
end; $$;

create or replace function public.lock_voucher_portal_scope(p_token_hash text, p_application_write boolean default false)
returns table(access_id uuid, principal_id uuid, voucher_id uuid, payment_id uuid,
  application_id uuid, legacy_user_id uuid)
language plpgsql security definer set search_path = '' as $$
declare candidate uuid; candidate_payment uuid; v public.vouchers; s record; p public.payments;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Applicant session unavailable' using errcode = '28000'; end if;
  select a.voucher_id,voucher.payment_id into candidate,candidate_payment from public.applicant_sessions x
    join public.voucher_access a on a.id=x.voucher_access_id
    join public.vouchers voucher on voucher.id=a.voucher_id where x.token_hash=p_token_hash;
  if not found then raise exception 'Applicant session unavailable' using errcode='28000'; end if;
  -- Payment first matches fulfillment; SHARE prevents a refund racing a write.
  -- Then voucher -> access -> principal -> session, matching login/redemption.
  select * into p from public.payments where id=candidate_payment for share;
  select * into v from public.vouchers where id=candidate for update;
  select * into s from public.resolve_voucher_session(p_token_hash);
  if not found or s.voucher_id is distinct from v.id then
    raise exception 'Applicant session unavailable' using errcode='28000'; end if;
  if p.id is null or p.id is distinct from v.payment_id
    or p.user_id is distinct from v.user_id or p.applicant_id is distinct from v.applicant_id then
    raise exception 'Applicant scope unavailable'; end if;
  if v.applicant_id is not null and v.applicant_id is distinct from s.applicant_id then raise exception 'Applicant scope unavailable'; end if;
  if s.application_id is not null and not exists(
    select 1 from public.applications a where a.id=s.application_id and a.voucher_id=v.id
      and a.user_id is not distinct from v.user_id and a.applicant_id is not distinct from v.applicant_id
  ) then raise exception 'Applicant scope unavailable'; end if;
  if p_application_write and (s.application_id is null or v.status <> 'used' or p.status <> 'successful') then
    raise exception 'Application is read only'; end if;
  return query select s.voucher_access_id,s.applicant_id,v.id,v.payment_id,s.application_id,v.user_id;
end; $$;

create or replace function public.load_voucher_portal(p_token_hash text, p_notifications_page integer default 1)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s record; payload jsonb; application_payload jsonb;
begin
  select * into s from public.lock_voucher_portal_scope(p_token_hash);
  if p_notifications_page is null or p_notifications_page not between 1 and 10000 then raise exception 'Invalid page'; end if;
  select jsonb_build_object(
    'voucher',jsonb_build_object('id',v.id,'serial',v.serial,'status',v.status,'expires_at',v.expires_at,'job_id',v.job_id),
    'payment',jsonb_build_object('id',p.id,'reference',p.reference,'status',p.status,'amount',p.amount,'currency',p.currency,'paid_at',p.paid_at,
      'provider',p.provider,'provider_id',p.provider_id,'created_at',p.created_at,
      'charge_amount',p.charge_amount,'charge_currency',p.charge_currency,'display_amount',p.display_amount,'display_currency',p.display_currency,
      'country_code',p.country_code,'region_code',p.region_code,'price_source',p.price_source,'display_minor_units',p.display_minor_units,
      'exchange_rate',p.exchange_rate,'exchange_rate_source',p.exchange_rate_source,'exchange_rate_as_of',p.exchange_rate_as_of),
    'product',jsonb_build_object('name',coalesce(p.product_name,t.name),'validity_days',p.validity_days)
  ) into payload from public.vouchers v join public.payments p on p.id=v.payment_id
    join public.voucher_types t on t.id=v.voucher_type_id where v.id=s.voucher_id;
  if s.application_id is not null then
    select jsonb_build_object('id',a.id,'reference',a.reference,'status',a.status,'revision',a.revision,
      'personal',a.personal,'identification',a.identification,'job_id',a.job_id,'updated_at',a.updated_at,'submitted_at',a.submitted_at,'declaration_at',a.declaration_at,
      'opportunity_title_snapshot',a.opportunity_title_snapshot,'service_description_snapshot',a.service_description_snapshot,
      'education',coalesce((select jsonb_agg(jsonb_build_object('institution',e.institution,'qualification',e.qualification,'field',e.field,'country',e.country,'start_date',e.start_date,'completion_date',e.completion_date) order by e.sort_order,e.id) from public.application_education e where e.application_id=a.id),'[]'::jsonb),
      'experience',coalesce((select jsonb_agg(jsonb_build_object('employer',e.employer,'position',e.position,'location',e.location,'start_date',e.start_date,'end_date',e.end_date,'responsibilities',e.responsibilities) order by e.sort_order,e.id) from public.application_experience e where e.application_id=a.id),'[]'::jsonb),
      'answers',coalesce((select jsonb_object_agg(x.question_id,x.answer) from public.application_answers x where x.application_id=a.id),'{}'::jsonb),
      'documents',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'kind',d.kind,'name',d.name,'size_bytes',d.size_bytes) order by d.created_at,d.id) from public.application_documents d where d.application_id=a.id and d.user_id is not distinct from s.legacy_user_id and d.applicant_id is not distinct from a.applicant_id),'[]'::jsonb),
      'history',coalesce((select jsonb_agg(jsonb_build_object('status',h.status,'message',h.message,'created_at',h.created_at) order by h.created_at,h.id) from public.application_status_history h where h.application_id=a.id),'[]'::jsonb),
      'job',jsonb_build_object('title',j.title,'company',j.company,'service_description',j.service_description,'questions',j.questions,'minimum_age',j.minimum_age,'required_documents',j.required_documents,'status',j.status,'application_deadline',j.application_deadline)
    ) into application_payload from public.applications a join public.jobs j on j.id=a.job_id
      where a.id=s.application_id and a.voucher_id=s.voucher_id and a.user_id is not distinct from s.legacy_user_id;
    if application_payload is null then raise exception 'Application unavailable'; end if;
  end if;
  return payload || jsonb_build_object('application',application_payload,
    'notifications',coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at desc,n.id desc) from (
      select x.id,x.title,x.body,x.read_at,x.created_at,l.application_id from public.notifications x
      join public.applicant_notification_links l on l.notification_id=x.id
      where l.voucher_access_id=s.access_id order by x.created_at desc,x.id desc
      limit 20 offset (p_notifications_page-1)*20) n),'[]'::jsonb),
    'unread_count',(select count(*) from public.notifications n join public.applicant_notification_links l on l.notification_id=n.id where l.voucher_access_id=s.access_id and n.read_at is null));
end; $$;

create or replace function public.save_portal_application(p_token_hash text, p_application_id uuid, p_revision integer, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s record; result jsonb;
begin
  select * into s from public.lock_voucher_portal_scope(p_token_hash,true);
  if p_application_id is distinct from s.application_id then raise exception 'Application unavailable'; end if;
  if s.legacy_user_id is null then
  result := public.save_application_draft_principal(s.principal_id,s.application_id,p_revision,p_data);
  else
  result := public.save_application_draft(s.legacy_user_id,s.application_id,p_revision,p_data);
  end if;
  insert into public.audit_logs(actor_applicant_id,action,target_type,target_id)
    values(s.principal_id,'voucher_application_saved','applications',s.application_id::text);
  return result;
end; $$;

create or replace function public.submit_portal_application(p_token_hash text, p_application_id uuid, p_revision integer, p_declaration boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s record; result jsonb; was_submitted boolean;
begin
  select * into s from public.lock_voucher_portal_scope(p_token_hash,true);
  if p_application_id is distinct from s.application_id then raise exception 'Application unavailable'; end if;
  select submitted_at is not null into was_submitted from public.applications where id=s.application_id for update;
  if s.legacy_user_id is null then
  result := public.submit_application_principal(s.principal_id,s.application_id,p_revision,p_declaration);
  else
  result := public.submit_application(s.legacy_user_id,s.application_id,p_revision,p_declaration);
  end if;
  if not was_submitted then insert into public.audit_logs(actor_applicant_id,action,target_type,target_id)
    values(s.principal_id,'voucher_application_submitted','applications',s.application_id::text); end if;
  return result;
end; $$;

create or replace function public.register_portal_document(p_token_hash text, p_application_id uuid, p_revision integer,
  p_document_id uuid, p_kind text, p_name text, p_mime text, p_size integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s record; path text; result jsonb;
begin
  select * into s from public.lock_voucher_portal_scope(p_token_hash,true);
  if p_application_id is distinct from s.application_id then raise exception 'Application unavailable'; end if;
  if p_mime is null or p_mime not in ('application/pdf','image/png','image/jpeg') or p_size is null or p_size not between 1 and 10485760 then raise exception 'Invalid document'; end if;
  path := public.portal_upload_context(p_token_hash,p_application_id,p_revision,p_document_id);
  if s.legacy_user_id is null then
  result := public.register_application_document_principal(s.principal_id,s.application_id,p_revision,p_document_id,p_kind,p_name,path,p_mime,p_size);
  else
  result := public.register_application_document(s.legacy_user_id,s.application_id,p_revision,p_document_id,p_kind,p_name,path,p_mime,p_size);
  end if;
  insert into public.audit_logs(actor_applicant_id,action,target_type,target_id)
    values(s.principal_id,'voucher_document_added','application_documents',p_document_id::text);
  return result;
end; $$;

create or replace function public.remove_portal_document(p_token_hash text, p_application_id uuid, p_revision integer, p_document_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s record; result jsonb;
begin
  select * into s from public.lock_voucher_portal_scope(p_token_hash,true);
  if p_application_id is distinct from s.application_id then raise exception 'Application unavailable'; end if;
  if s.legacy_user_id is null then
  result := public.remove_application_document_principal(s.principal_id,s.application_id,p_revision,p_document_id);
  else
  result := public.remove_application_document(s.legacy_user_id,s.application_id,p_revision,p_document_id);
  end if;
  insert into public.audit_logs(actor_applicant_id,action,target_type,target_id)
    values(s.principal_id,'voucher_document_removed','application_documents',p_document_id::text);
  return result;
end; $$;

create or replace function public.portal_upload_context(p_token_hash text, p_application_id uuid, p_revision integer, p_document_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare s record; a public.applications;
begin
  select * into s from public.lock_voucher_portal_scope(p_token_hash,true);
  if p_application_id is distinct from s.application_id or p_document_id is null then raise exception 'Application unavailable'; end if;
  select * into a from public.applications where id=s.application_id for update;
  if a.status <> 'draft' then raise exception 'Application is read only'; end if;
  if p_revision is distinct from a.revision then raise exception 'Revision conflict'; end if;
  return coalesce(s.legacy_user_id,s.principal_id)::text || '/' || s.application_id::text || '/' || p_document_id::text;
end; $$;

create or replace function public.authorize_portal_document(p_token_hash text, p_application_id uuid, p_document_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s record; result jsonb;
begin
  select * into s from public.lock_voucher_portal_scope(p_token_hash);
  if p_application_id is distinct from s.application_id then raise exception 'Application unavailable'; end if;
  select jsonb_build_object('storage_path',d.storage_path,'name',d.name,'mime_type',d.mime_type) into result
    from public.application_documents d where d.id=p_document_id and d.application_id=s.application_id and d.user_id is not distinct from s.legacy_user_id and d.applicant_id is not distinct from (case when s.legacy_user_id is null then s.principal_id else null end);
  if result is null then raise exception 'Document unavailable'; end if;
  return result;
end; $$;

create or replace function public.redeem_portal_voucher(p_token_hash text, p_job_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s record; v public.vouchers; result uuid;
begin
  select * into s from public.lock_voucher_portal_scope(p_token_hash);
  if s.application_id is not null then
    if exists(select 1 from public.applications where id=s.application_id and job_id=p_job_id) then return s.application_id; end if;
    raise exception 'Application unavailable';
  end if;
  if not exists(select 1 from public.payments where id=s.payment_id and status='successful') then raise exception 'Voucher unavailable'; end if;
  select * into v from public.vouchers where id=s.voucher_id;
  if s.legacy_user_id is not null then
    result := public.redeem_verified_voucher(s.legacy_user_id,v.serial,v.pin_hash,p_job_id);
  else
    if v.status<>'unused' or v.expires_at<=clock_timestamp() or (v.job_id is not null and v.job_id<>p_job_id) then raise exception 'Voucher unavailable'; end if;
    perform 1 from public.jobs where id=p_job_id and status='published' and opportunity_type='managed' and not sample and (application_deadline is null or application_deadline>now()) for share;
    if not found then raise exception 'Opportunity unavailable'; end if;
    insert into public.applications(applicant_id,job_id,voucher_id) values(s.principal_id,p_job_id,v.id) returning id into result;
    update public.vouchers set status='used',activated_at=now(),job_id=p_job_id where id=v.id;
    insert into public.application_status_history(application_id,status,message,actor_applicant_id) values(result,'draft','Application started with a verified voucher.',s.principal_id);
    insert into public.notifications(applicant_id,title,body,href) values(s.principal_id,'Application started','Your application draft is ready to complete.','/dashboard/applications/'||result::text);
  end if;
  insert into public.audit_logs(actor_applicant_id,action,target_type,target_id)
    values(s.principal_id,'voucher_application_started','applications',result::text);
  return result;
end; $$;

create or replace function public.review_application(
  p_request_id uuid, p_actor_id uuid, p_application_id uuid,
  p_revision integer, p_status public.application_status, p_message text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  application public.applications;
  previous public.application_review_commands;
  staff_role public.app_role;
  allowed boolean;
  next_revision integer;
begin
  if p_request_id is null or p_actor_id is null or p_application_id is null
    or p_revision is null or p_revision < 0 or p_status is null
    or p_message is null or length(btrim(p_message)) not between 10 and 2000 then
    raise exception 'Invalid review parameters';
  end if;
  -- Lock the role so revocation cannot race an authorized decision.
  select role into staff_role from public.profiles where id = p_actor_id for share;
  if not found or staff_role not in ('admin','super_admin') then
    raise exception 'Administrator required';
  end if;
  select * into application from public.applications where id = p_application_id for update;
  if not found then raise exception 'Application not found'; end if;

  select * into previous from public.application_review_commands where request_id = p_request_id;
  if found then
    if previous.application_id is distinct from p_application_id
      or previous.actor_id is distinct from p_actor_id
      or previous.expected_revision is distinct from p_revision
      or previous.next_status is distinct from p_status
      or previous.applicant_message is distinct from btrim(p_message) then
      raise exception 'Review request conflict';
    end if;
    return jsonb_build_object('reference',application.reference,
      'status',previous.next_status,'revision',previous.result_revision,'replayed',true);
  end if;
  if application.submitted_at is null or application.status = 'draft' then
    raise exception 'Only submitted applications can be reviewed';
  end if;
  if application.revision <> p_revision then raise exception 'Revision conflict'; end if;

  -- Internal screening only. Applicant-driven withdrawal requires a separate
  -- protected operation; this RPC cannot withdraw or reopen terminal states.
  allowed := case application.status
    when 'submitted' then p_status in ('under_review')
    when 'under_review' then p_status in ('additional_information_required','shortlisted','unsuccessful')
    when 'additional_information_required' then p_status in ('under_review')
    when 'shortlisted' then p_status in ('interview','final_review','unsuccessful')
    when 'interview' then p_status in ('final_review','unsuccessful')
    when 'final_review' then p_status in ('accepted','unsuccessful','additional_information_required')
    else false
  end;
  if not allowed then raise exception 'Review transition not permitted'; end if;
  next_revision := application.revision + 1;
  -- Reserve the retry key in the same transaction. A cross-application key
  -- collision rolls back the entire operation rather than creating duplicates.
  insert into public.application_review_commands(
    request_id,application_id,actor_id,expected_revision,next_status,applicant_message,result_revision
  ) values(p_request_id,p_application_id,p_actor_id,p_revision,p_status,btrim(p_message),next_revision);
  update public.applications set status = p_status,revision = next_revision,updated_at = clock_timestamp() where id = p_application_id;
  insert into public.application_status_history(application_id,status,message,actor_id)
    values(p_application_id,p_status,btrim(p_message),p_actor_id);
  insert into public.notifications(user_id,applicant_id,title,body,href)
    values(application.user_id,application.applicant_id,'Application update',
      application.reference || ': ' || case when p_status = 'accepted'
        then 'Accepted/qualified through CruiseApply internal screening. This is not hiring, employment or selection by a cruise company and does not guarantee employer referral.'
        else replace(p_status::text,'_',' ') || '. Open your application to read the screening update.' end,
      '/dashboard/applications/' || p_application_id::text);
  insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
    values(p_actor_id,'application_reviewed','applications',p_application_id::text,
      jsonb_build_object('request_id',p_request_id,'from_status',application.status,
        'to_status',p_status,'from_revision',p_revision,'to_revision',next_revision));
  return jsonb_build_object('reference',application.reference,'status',p_status,
    'revision',next_revision,'replayed',false);
end; $$;

-- New functions: remove PUBLIC and named-role defaults, including direct access
-- to internal helpers/engines. Existing replaced RPC ACLs stay unchanged.
do $$ declare signature text; begin
  foreach signature in array array['guard_principal_business_chain()','lock_guest_checkout(text)',
    'save_application_draft_principal(uuid,uuid,integer,jsonb)',
    'register_application_document_principal(uuid,uuid,integer,uuid,text,text,text,text,integer)',
    'remove_application_document_principal(uuid,uuid,integer,uuid)','submit_application_principal(uuid,uuid,integer,boolean)',
    'begin_guest_checkout(text,text,text,text)','create_guest_quote(text,uuid)','create_guest_payment(text,uuid,text,uuid)',
    'get_guest_checkout(text)','claim_guest_voucher(text,text,text)'] loop
    execute 'revoke all on function public.'||signature||' from public,anon,authenticated,service_role';
  end loop;
  foreach signature in array array['begin_guest_checkout(text,text,text,text)','create_guest_quote(text,uuid)',
    'create_guest_payment(text,uuid,text,uuid)','get_guest_checkout(text)','claim_guest_voucher(text,text,text)'] loop
    execute 'grant execute on function public.'||signature||' to service_role';
  end loop;
end; $$;
commit;

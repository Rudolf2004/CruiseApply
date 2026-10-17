import { readFile,writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
// Generates one review artifact locally. Never opens a database connection.
const read=(name:string)=>readFile('supabase/migrations/'+name,'utf8');
function fn(sql:string,name:string){const start=sql.indexOf('create function public.'+name+'(');assert.ok(start>=0,name);const end=sql.indexOf('$$;',start);assert.ok(end>start);return sql.slice(start,end+3);}
function change(s:string,from:string,to:string){assert.ok(s.includes(from),'Missing replacement '+from);return s.split(from).join(to);}
const workflow=await read('202609290004_application_workflow.sql'),pricing=await read('202609290003_regional_voucher_pricing.sql'),oldPortal=await read('202610030010_voucher_scoped_portal.sql');
let sql=`-- REVIEW ONLY. Guest ownership, verified fulfillment and one-time initial claim.
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
`;
// Reuse the authoritative regional calculation exactly; only owner/contact source changes.
let quote=fn(pricing,'quote_voucher_price');
quote=change(quote,'quote_voucher_price(p_user_id uuid, p_type_id uuid, p_country_code text)','create_guest_quote(p_capability_hash text, p_type_id uuid)');
quote=change(quote,'product public.voucher_types;','checkout public.guest_checkouts; p_country_code text; product public.voucher_types;');
quote=change(quote,'begin\n  select * into product',"begin\n  checkout := public.lock_guest_checkout(p_capability_hash); p_country_code := checkout.country_code;\n  if exists(select 1 from public.payments where guest_checkout_id=checkout.id) then raise exception 'Checkout already initialized'; end if;\n  select * into product");
quote=change(quote,'public.payment_quotes(user_id,','public.payment_quotes(applicant_id,guest_checkout_id,');
quote=change(quote,'values(p_user_id,product.id','values(checkout.applicant_id,checkout.id,product.id');
sql+='\n'+quote+'\n';
sql+=`
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
`;
let fulfill=fn(await read('202609290002_payment_vouchers.sql'),'fulfill_verified_payment');
fulfill=change(fulfill,'create function','create or replace function');
fulfill=change(fulfill,'declare payment public.payments; voucher_id uuid;','declare payment public.payments; voucher_id uuid; access_id uuid; checkout public.guest_checkouts; notice_id uuid;');
fulfill=change(fulfill,"  if coalesce(p_pin_hash, '') = ''",`  if payment.applicant_id is not null then
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
  if coalesce(p_pin_hash, '') = ''`);
sql+='\n'+fulfill+'\n';
sql+=`
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
`;
// Private principal engines retain the tested legacy revision/document/submission rules.
for(const name of ['save_application_draft','register_application_document','remove_application_document','submit_application']){
  let engine=fn(workflow,name);engine=change(engine,name+'(',name+'_principal(');engine=engine.replaceAll('p_user_id','p_applicant_id').replace(/\buser_id\b/g,'applicant_id').replace(/\bactor_id\b/g,'actor_applicant_id');sql+='\n'+engine+'\n';
}
let scope=fn(oldPortal,'lock_voucher_portal_scope');scope=change(scope,'create function','create or replace function');
scope=change(scope,"  if v.user_id is null or v.applicant_id is not null then raise exception 'Applicant scope unavailable'; end if;","  if v.applicant_id is not null and v.applicant_id is distinct from s.applicant_id then raise exception 'Applicant scope unavailable'; end if;");
scope=scope.replace(/  -- 0008 intentionally[^\n]*\n  -- separate Phase B[^\n]*\n/,'');sql+='\n'+scope+'\n';
let loader=fn(oldPortal,'load_voucher_portal');loader=change(loader,'create function','create or replace function');loader=change(loader,'d.user_id=s.legacy_user_id','d.user_id is not distinct from s.legacy_user_id and d.applicant_id is not distinct from a.applicant_id');loader=change(loader,'a.user_id=s.legacy_user_id','a.user_id is not distinct from s.legacy_user_id');sql+='\n'+loader+'\n';
for(const [name,engine] of [['save_portal_application','save_application_draft'],['submit_portal_application','submit_application'],['register_portal_document','register_application_document'],['remove_portal_document','remove_application_document']]){
  let wrapper=fn(oldPortal,name);wrapper=change(wrapper,'create function','create or replace function');
  const line=wrapper.split('\n').find(l=>l.includes('result := public.'+engine+'('))!;assert.ok(line);
  const principal=change(line,engine+'(s.legacy_user_id',engine+'_principal(s.principal_id');
  wrapper=change(wrapper,line,'  if s.legacy_user_id is null then\n'+principal+'\n  else\n'+line+'\n  end if;');sql+='\n'+wrapper+'\n';
}
let upload=fn(oldPortal,'portal_upload_context');upload=change(upload,'create function','create or replace function');upload=change(upload,'s.legacy_user_id::text','coalesce(s.legacy_user_id,s.principal_id)::text');sql+='\n'+upload+'\n';
let download=fn(oldPortal,'authorize_portal_document');download=change(download,'create function','create or replace function');download=change(download,'d.user_id=s.legacy_user_id','d.user_id is not distinct from s.legacy_user_id and d.applicant_id is not distinct from (case when s.legacy_user_id is null then s.principal_id else null end)');sql+='\n'+download+'\n';
let redeem=fn(oldPortal,'redeem_portal_voucher');redeem=change(redeem,'create function','create or replace function');
redeem=change(redeem,'  result := public.redeem_verified_voucher(s.legacy_user_id,v.serial,v.pin_hash,p_job_id);',`  if s.legacy_user_id is not null then
    result := public.redeem_verified_voucher(s.legacy_user_id,v.serial,v.pin_hash,p_job_id);
  else
    if v.status<>'unused' or v.expires_at<=clock_timestamp() or (v.job_id is not null and v.job_id<>p_job_id) then raise exception 'Voucher unavailable'; end if;
    perform 1 from public.jobs where id=p_job_id and status='published' and opportunity_type='managed' and not sample and (application_deadline is null or application_deadline>now()) for share;
    if not found then raise exception 'Opportunity unavailable'; end if;
    insert into public.applications(applicant_id,job_id,voucher_id) values(s.principal_id,p_job_id,v.id) returning id into result;
    update public.vouchers set status='used',activated_at=now(),job_id=p_job_id where id=v.id;
    insert into public.application_status_history(application_id,status,message,actor_applicant_id) values(result,'draft','Application started with a verified voucher.',s.principal_id);
    insert into public.notifications(applicant_id,title,body,href) values(s.principal_id,'Application started','Your application draft is ready to complete.','/dashboard/applications/'||result::text);
  end if;`);sql+='\n'+redeem+'\n';
let review=fn(await read('202609300006_admin_review.sql'),'review_application');review=change(review,'create function','create or replace function');review=change(review,'public.notifications(user_id,title,body,href)','public.notifications(user_id,applicant_id,title,body,href)');review=change(review,"values(application.user_id,'Application update'","values(application.user_id,application.applicant_id,'Application update'");sql+='\n'+review+'\n';
sql+=`
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
`;
await writeFile('supabase/migrations/202610030011_guest_checkout_claim.sql',sql);
console.log('Prepared unapplied 0011 review artifact; no database connection.');

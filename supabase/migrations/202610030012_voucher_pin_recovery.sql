-- REVIEW ONLY: verified voucher-specific PIN rotation. Apply manually after 0011.
-- No migration-time business-row DML, ownership backfill, email or Paystack calls.
begin;

-- Internal lock order matches the portal: payment -> voucher -> access ->
-- principal -> contact/challenge -> sessions. No email-based owner joins.
create function public.lock_voucher_recovery(p_identifier text,p_adopt boolean)
returns public.voucher_access language plpgsql security definer set search_path='' as $$
declare v public.vouchers; p public.payments; a public.voucher_access; principal uuid;
begin
  if p_identifier is null or length(p_identifier) not between 8 and 100 then return null; end if;
  select v0.* into v from public.vouchers v0 join public.payments p0 on p0.id=v0.payment_id
    where v0.serial=p_identifier or p0.reference=p_identifier;
  if not found then return null; end if;
  select * into p from public.payments where id=v.payment_id for share;
  select * into v from public.vouchers where id=v.id for update;
  if p.paid_at is null or p.status not in ('successful','refunded')
    or v.user_id is distinct from p.user_id or v.applicant_id is distinct from p.applicant_id then return null; end if;
  if (v.status='cancelled' or p.status='refunded') and not exists(select 1 from public.applications where voucher_id=v.id) then return null; end if;
  select * into a from public.voucher_access where voucher_id=v.id for update;
  if not found then
    if not p_adopt or v.user_id is null then return null; end if;
    insert into public.applicant_principals default values returning id into principal;
    insert into public.voucher_access(voucher_id,applicant_id,legacy_user_id,credential_state)
      values(v.id,principal,v.user_id,'legacy') returning * into a;
    insert into public.audit_logs(action,target_type,target_id)
      values('voucher_recovery_access_bound','voucher_access',a.id::text);
  end if;
  if a.revoked_at is not null or a.suspended_at is not null then return null; end if;
  perform 1 from public.applicant_principals where id=a.applicant_id and disabled_at is null for share;
  if not found then return null; end if;
  return a;
end; $$;

create function public.request_voucher_pin_reset(p_identifier text,p_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.voucher_access; c public.voucher_contacts; v public.vouchers; challenge uuid; deadline timestamptz;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'Recovery unavailable'; end if;
  a:=public.lock_voucher_recovery(p_identifier,true);
  if a.id is null then return null; end if;
  select * into v from public.vouchers where id=a.voucher_id;
  -- For legacy access only, bind the immutable verified purchase contact on demand.
  -- This does not verify the address, rotate a PIN or grant a session.
  insert into public.voucher_contacts(voucher_access_id,email)
    select a.id,p.customer_email from public.payments p where p.id=v.payment_id
    on conflict(voucher_access_id) do nothing;
  select * into c from public.voucher_contacts where voucher_access_id=a.id for update;
  update public.voucher_contact_challenges set revoked_at=clock_timestamp()
    where voucher_access_id=a.id and purpose='reset_pin' and consumed_at is null and revoked_at is null;
  deadline:=clock_timestamp()+interval '15 minutes';
  insert into public.voucher_contact_challenges(voucher_access_id,contact_id,contact_version,purpose,token_hash,expires_at)
    values(a.id,c.id,c.contact_version,'reset_pin',p_token_hash,deadline) returning id into challenge;
  insert into public.audit_logs(action,target_type,target_id)
    values('voucher_pin_reset_requested','voucher_contact_challenges',challenge::text);
  -- Server-only delivery material; never sent to the requesting browser.
  return jsonb_build_object('email',c.email,'serial',v.serial,'expires_at',deadline);
end; $$;

create function public.complete_voucher_pin_reset(p_identifier text,p_token_hash text,p_new_pin_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.voucher_access; c public.voucher_contacts; challenge public.voucher_contact_challenges; at_time timestamptz;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or p_new_pin_hash is null
    or p_new_pin_hash !~ '^s1:[a-f0-9]{32}:[a-f0-9]{64}$' then raise exception 'Recovery unavailable'; end if;
  a:=public.lock_voucher_recovery(p_identifier,false);
  if a.id is null then raise exception 'Recovery unavailable'; end if;
  select * into c from public.voucher_contacts where voucher_access_id=a.id for share;
  select * into challenge from public.voucher_contact_challenges where token_hash=p_token_hash and voucher_access_id=a.id for update;
  at_time:=clock_timestamp();
  if not found or challenge.purpose<>'reset_pin' or challenge.contact_id is distinct from c.id
    or challenge.contact_version is distinct from c.contact_version or challenge.consumed_at is not null
    or challenge.revoked_at is not null or challenge.expires_at<=at_time or p_new_pin_hash is not distinct from a.pin_hash then
    raise exception 'Recovery unavailable';
  end if;
  update public.voucher_contacts set verified_at=at_time where id=c.id;
  update public.voucher_access set credential_state='current',pin_hash=p_new_pin_hash,
    credential_version=credential_version+1,credential_rotated_at=at_time where id=a.id;
  update public.applicant_sessions set revoked_at=at_time where voucher_access_id=a.id and revoked_at is null;
  update public.voucher_contact_challenges set consumed_at=at_time where id=challenge.id;
  update public.voucher_contact_challenges set revoked_at=at_time
    where voucher_access_id=a.id and id<>challenge.id and consumed_at is null and revoked_at is null;
  update public.voucher_credential_deliveries set revoked_at=at_time
    where voucher_access_id=a.id and consumed_at is null and revoked_at is null;
  insert into public.audit_logs(actor_applicant_id,action,target_type,target_id)
    values(a.applicant_id,'voucher_pin_rotated','voucher_access',a.id::text);
  return jsonb_build_object('serial',(select serial from public.vouchers where id=a.voucher_id));
end; $$;

-- Failed/ambiguous mail transport revokes that challenge. Never returns a token.
create function public.revoke_voucher_pin_reset(p_token_hash text)
returns void language plpgsql security definer set search_path='' as $$
declare access_id uuid;
begin
  select voucher_access_id into access_id from public.voucher_contact_challenges where token_hash=p_token_hash and purpose='reset_pin';
  if not found then return; end if;
  perform 1 from public.voucher_access where id=access_id for update;
  update public.voucher_contact_challenges set revoked_at=clock_timestamp()
    where token_hash=p_token_hash and purpose='reset_pin' and consumed_at is null and revoked_at is null;
end; $$;

revoke all on function public.lock_voucher_recovery(text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.request_voucher_pin_reset(text,text) from public,anon,authenticated,service_role;
revoke all on function public.complete_voucher_pin_reset(text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.revoke_voucher_pin_reset(text) from public,anon,authenticated,service_role;
grant execute on function public.request_voucher_pin_reset(text,text) to service_role;
grant execute on function public.complete_voucher_pin_reset(text,text,text) to service_role;
grant execute on function public.revoke_voucher_pin_reset(text) to service_role;

-- Legacy redemption proof stays consistent with rotated access.
create or replace function public.redeem_verified_voucher(p_user_id uuid, p_serial text, p_pin_hash text, p_job_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare access_row public.voucher_access; authoritative_hash text; voucher public.vouchers; selected_job public.jobs; application_id uuid;
begin
  select * into voucher from public.vouchers where serial = p_serial and user_id = p_user_id for update;
  if not found then raise exception 'Invalid voucher'; end if;
  select * into access_row from public.voucher_access where voucher_id=voucher.id for update;
  if found and (access_row.revoked_at is not null or access_row.suspended_at is not null
    or exists(select 1 from public.applicant_principals where id=access_row.applicant_id and disabled_at is not null)) then raise exception 'Invalid voucher'; end if;
  authoritative_hash:=case when access_row.credential_state='current' then access_row.pin_hash else voucher.pin_hash end;
  if authoritative_hash is distinct from p_pin_hash then raise exception 'Invalid voucher'; end if;
  if voucher.status <> 'unused' or voucher.expires_at <= now() then raise exception 'Voucher unavailable'; end if;
  if voucher.job_id is not null and voucher.job_id <> p_job_id then raise exception 'Voucher is linked to another job'; end if;
  select * into selected_job from public.jobs where id = p_job_id for share;
  if not found or selected_job.status <> 'published' or selected_job.sample
    or selected_job.application_deadline <= now() then raise exception 'Job unavailable'; end if;
  insert into public.applications(user_id, job_id, voucher_id)
  values(p_user_id, p_job_id, voucher.id) returning id into application_id;
  update public.vouchers set status = 'used', activated_at = now(), job_id = p_job_id where id = voucher.id;
  insert into public.application_status_history(application_id, status, message, actor_id)
  values(application_id, 'draft', 'Application started with a verified voucher.', p_user_id);
  insert into public.notifications(user_id, title, body, href)
  values(p_user_id, 'Application started', 'Your application draft is ready to complete.', '/dashboard/applications');
  return application_id;
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
    result := public.redeem_verified_voucher(s.legacy_user_id,v.serial,(select case when a.credential_state='current' then a.pin_hash else v.pin_hash end from public.voucher_access a where a.voucher_id=v.id),p_job_id);
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

commit;

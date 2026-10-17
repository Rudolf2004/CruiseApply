-- REVIEW ONLY. Phase A database prerequisite; apply manually after 0009.
-- No backfill, ownership activation, applicant rollout or business-row DML.
begin;

-- NO KEY UPDATE still serializes credential/session revocation. It also permits
-- notification FK KEY SHARE locks, avoiding access/application lock inversion
-- when existing staff review writes an application-specific notification.
create or replace function public.resolve_voucher_session(p_token_hash text)
returns table(session_id uuid, voucher_access_id uuid, applicant_id uuid,
  voucher_id uuid, payment_id uuid, application_id uuid,
  idle_expires_at timestamptz, absolute_expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  access_id uuid; access_row public.voucher_access; principal public.applicant_principals;
  session_row public.applicant_sessions; at_time timestamptz;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then return; end if;
  select s.voucher_access_id into access_id from public.applicant_sessions s where s.token_hash = p_token_hash;
  if not found then return; end if;
  select * into access_row from public.voucher_access where id = access_id for no key update;
  if not found or access_row.revoked_at is not null or access_row.suspended_at is not null
    or access_row.credential_state not in ('legacy','current') then return; end if;
  select * into principal from public.applicant_principals where id = access_row.applicant_id for share;
  if not found or principal.disabled_at is not null then return; end if;
  select * into session_row from public.applicant_sessions s where s.token_hash = p_token_hash for update;
  at_time := clock_timestamp();
  if not found or session_row.voucher_access_id <> access_row.id
    or session_row.revoked_at is not null or session_row.credential_version <> access_row.credential_version
    or session_row.idle_expires_at <= at_time or session_row.absolute_expires_at <= at_time then return; end if;
  update public.applicant_sessions s set last_seen_at = at_time,
    idle_expires_at = least(at_time + interval '168 hours', s.absolute_expires_at)
    where s.id = session_row.id returning * into session_row;
  return query select session_row.id, access_row.id, principal.id, v.id, v.payment_id,
    a.id, session_row.idle_expires_at, session_row.absolute_expires_at
    from public.vouchers v left join public.applications a on a.voucher_id = v.id
    where v.id = access_row.voucher_id;
end; $$;

-- Internal helper, not directly callable even by service_role. Every public RPC
-- independently authenticates and holds locks through its own read/write.
create function public.lock_voucher_portal_scope(p_token_hash text, p_application_write boolean default false)
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
  -- 0008 intentionally retains user_id NOT NULL. Guest-owner activation is a
  -- separate Phase B migration, not silently enabled by the portal bridge.
  if v.user_id is null or v.applicant_id is not null then raise exception 'Applicant scope unavailable'; end if;
  if s.application_id is not null and not exists(
    select 1 from public.applications a where a.id=s.application_id and a.voucher_id=v.id
      and a.user_id is not distinct from v.user_id and a.applicant_id is not distinct from v.applicant_id
  ) then raise exception 'Applicant scope unavailable'; end if;
  if p_application_write and (s.application_id is null or v.status <> 'used' or p.status <> 'successful') then
    raise exception 'Application is read only'; end if;
  return query select s.voucher_access_id,s.applicant_id,v.id,v.payment_id,s.application_id,v.user_id;
end; $$;

-- Future application-specific messages are linked at insertion. Ambiguous old
-- user-wide notifications remain unlinked; no ownership is guessed or backfilled.
create function public.link_voucher_application_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
declare application_uuid uuid; access_uuid uuid;
begin
  if new.href is null or new.href !~ '^/dashboard/applications/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return new; end if;
  application_uuid := split_part(new.href,'/',4)::uuid;
  select va.id into access_uuid from public.applications a join public.voucher_access va on va.voucher_id=a.voucher_id
    where a.id=application_uuid and a.user_id is not distinct from new.user_id
      and a.applicant_id is not distinct from new.applicant_id;
  if found then insert into public.applicant_notification_links(notification_id,voucher_access_id,application_id)
    values(new.id,access_uuid,application_uuid); end if;
  return new;
end; $$;
create trigger voucher_application_notification after insert on public.notifications
  for each row execute function public.link_voucher_application_notification();

create function public.load_voucher_portal(p_token_hash text, p_notifications_page integer default 1)
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
      'documents',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'kind',d.kind,'name',d.name,'size_bytes',d.size_bytes) order by d.created_at,d.id) from public.application_documents d where d.application_id=a.id and d.user_id=s.legacy_user_id),'[]'::jsonb),
      'history',coalesce((select jsonb_agg(jsonb_build_object('status',h.status,'message',h.message,'created_at',h.created_at) order by h.created_at,h.id) from public.application_status_history h where h.application_id=a.id),'[]'::jsonb),
      'job',jsonb_build_object('title',j.title,'company',j.company,'service_description',j.service_description,'questions',j.questions,'minimum_age',j.minimum_age,'required_documents',j.required_documents,'status',j.status,'application_deadline',j.application_deadline)
    ) into application_payload from public.applications a join public.jobs j on j.id=a.job_id
      where a.id=s.application_id and a.voucher_id=s.voucher_id and a.user_id=s.legacy_user_id;
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

create function public.redeem_portal_voucher(p_token_hash text, p_job_id uuid)
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
  result := public.redeem_verified_voucher(s.legacy_user_id,v.serial,v.pin_hash,p_job_id);
  insert into public.audit_logs(actor_applicant_id,action,target_type,target_id)
    values(s.principal_id,'voucher_application_started','applications',result::text);
  return result;
end; $$;

create function public.save_portal_application(p_token_hash text, p_application_id uuid, p_revision integer, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s record; result jsonb;
begin
  select * into s from public.lock_voucher_portal_scope(p_token_hash,true);
  if p_application_id is distinct from s.application_id then raise exception 'Application unavailable'; end if;
  result := public.save_application_draft(s.legacy_user_id,s.application_id,p_revision,p_data);
  insert into public.audit_logs(actor_applicant_id,action,target_type,target_id)
    values(s.principal_id,'voucher_application_saved','applications',s.application_id::text);
  return result;
end; $$;

create function public.submit_portal_application(p_token_hash text, p_application_id uuid, p_revision integer, p_declaration boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s record; result jsonb; was_submitted boolean;
begin
  select * into s from public.lock_voucher_portal_scope(p_token_hash,true);
  if p_application_id is distinct from s.application_id then raise exception 'Application unavailable'; end if;
  select submitted_at is not null into was_submitted from public.applications where id=s.application_id for update;
  result := public.submit_application(s.legacy_user_id,s.application_id,p_revision,p_declaration);
  if not was_submitted then insert into public.audit_logs(actor_applicant_id,action,target_type,target_id)
    values(s.principal_id,'voucher_application_submitted','applications',s.application_id::text); end if;
  return result;
end; $$;

create function public.portal_upload_context(p_token_hash text, p_application_id uuid, p_revision integer, p_document_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare s record; a public.applications;
begin
  select * into s from public.lock_voucher_portal_scope(p_token_hash,true);
  if p_application_id is distinct from s.application_id or p_document_id is null then raise exception 'Application unavailable'; end if;
  select * into a from public.applications where id=s.application_id for update;
  if a.status <> 'draft' then raise exception 'Application is read only'; end if;
  if p_revision is distinct from a.revision then raise exception 'Revision conflict'; end if;
  return s.legacy_user_id::text || '/' || s.application_id::text || '/' || p_document_id::text;
end; $$;

create function public.register_portal_document(p_token_hash text, p_application_id uuid, p_revision integer,
  p_document_id uuid, p_kind text, p_name text, p_mime text, p_size integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s record; path text; result jsonb;
begin
  select * into s from public.lock_voucher_portal_scope(p_token_hash,true);
  if p_application_id is distinct from s.application_id then raise exception 'Application unavailable'; end if;
  if p_mime is null or p_mime not in ('application/pdf','image/png','image/jpeg') or p_size is null or p_size not between 1 and 10485760 then raise exception 'Invalid document'; end if;
  path := public.portal_upload_context(p_token_hash,p_application_id,p_revision,p_document_id);
  result := public.register_application_document(s.legacy_user_id,s.application_id,p_revision,p_document_id,p_kind,p_name,path,p_mime,p_size);
  insert into public.audit_logs(actor_applicant_id,action,target_type,target_id)
    values(s.principal_id,'voucher_document_added','application_documents',p_document_id::text);
  return result;
end; $$;

create function public.remove_portal_document(p_token_hash text, p_application_id uuid, p_revision integer, p_document_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s record; result jsonb;
begin
  select * into s from public.lock_voucher_portal_scope(p_token_hash,true);
  if p_application_id is distinct from s.application_id then raise exception 'Application unavailable'; end if;
  result := public.remove_application_document(s.legacy_user_id,s.application_id,p_revision,p_document_id);
  insert into public.audit_logs(actor_applicant_id,action,target_type,target_id)
    values(s.principal_id,'voucher_document_removed','application_documents',p_document_id::text);
  return result;
end; $$;

-- This DTO is for server-to-storage use only. Stream the file through the server;
-- never expose storage paths or create a long-lived public/signed URL.
create function public.authorize_portal_document(p_token_hash text, p_application_id uuid, p_document_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s record; result jsonb;
begin
  select * into s from public.lock_voucher_portal_scope(p_token_hash);
  if p_application_id is distinct from s.application_id then raise exception 'Application unavailable'; end if;
  select jsonb_build_object('storage_path',d.storage_path,'name',d.name,'mime_type',d.mime_type) into result
    from public.application_documents d where d.id=p_document_id and d.application_id=s.application_id and d.user_id=s.legacy_user_id;
  if result is null then raise exception 'Document unavailable'; end if;
  return result;
end; $$;

create function public.read_portal_notification(p_token_hash text, p_notification_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s record; n public.notifications;
begin
  select * into s from public.lock_voucher_portal_scope(p_token_hash);
  select x.* into n from public.notifications x join public.applicant_notification_links l on l.notification_id=x.id
    where x.id=p_notification_id and l.voucher_access_id=s.access_id for update of x;
  if not found then raise exception 'Notification unavailable'; end if;
  if n.read_at is null then update public.notifications set read_at=clock_timestamp() where id=n.id returning * into n; end if;
  return jsonb_build_object('id',n.id,'read_at',n.read_at);
end; $$;

revoke all on function public.lock_voucher_portal_scope(text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.link_voucher_application_notification() from public,anon,authenticated,service_role;
do $$
declare signature text;
begin
  foreach signature in array array[
    'load_voucher_portal(text,integer)','redeem_portal_voucher(text,uuid)',
    'save_portal_application(text,uuid,integer,jsonb)','submit_portal_application(text,uuid,integer,boolean)',
    'portal_upload_context(text,uuid,integer,uuid)',
    'register_portal_document(text,uuid,integer,uuid,text,text,text,integer)',
    'remove_portal_document(text,uuid,integer,uuid)','authorize_portal_document(text,uuid,uuid)',
    'read_portal_notification(text,uuid)'
  ] loop
    execute 'revoke all on function public.' || signature || ' from public,anon,authenticated,service_role';
    execute 'grant execute on function public.' || signature || ' to service_role';
  end loop;
end; $$;
-- resolve_voucher_session keeps its existing signature/owner/ACL unchanged.
commit;

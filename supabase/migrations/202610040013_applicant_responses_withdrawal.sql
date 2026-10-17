-- REVIEW ONLY: applicant replies with private attachments and explicit withdrawal.
-- Apply manually after 0012. No business-row DML or applicant rollout at install.
begin;
create table public.application_applicant_commands (
  request_id uuid primary key,
  application_id uuid not null references public.applications,
  voucher_access_id uuid not null references public.voucher_access,
  expected_revision integer not null check(expected_revision >= 0),
  operation text not null check(operation in ('response','withdraw')),
  body text not null check(length(btrim(body)) between 10 and 4000),
  documents jsonb not null default '[]' check(jsonb_typeof(documents)='array' and jsonb_array_length(documents)<=5),
  result_revision integer not null check(result_revision=expected_revision+1),
  result_status public.application_status not null,
  created_at timestamptz not null default now(),
  check((operation='response' and result_status='under_review') or
    (operation='withdraw' and result_status='withdrawn' and documents='[]'::jsonb))
);
create index applicant_commands_application on public.application_applicant_commands(application_id,created_at,request_id);
create index applicant_commands_access on public.application_applicant_commands(voucher_access_id);
alter table public.application_applicant_commands enable row level security;
revoke all on public.application_applicant_commands from public,anon,authenticated,service_role;
grant select on public.application_applicant_commands to authenticated;
create policy applicant_commands_staff_read on public.application_applicant_commands for select to authenticated using(public.is_admin());
grant select,insert,delete on public.application_applicant_commands to service_role;

create function public.guard_applicant_command() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' then raise exception 'Applicant command is immutable'; end if;
  if not exists(select 1 from public.applications a join public.voucher_access v on v.voucher_id=a.voucher_id
    where a.id=new.application_id and v.id=new.voucher_access_id
    and ((a.user_id is not null and a.user_id=v.legacy_user_id) or (a.applicant_id is not null and a.applicant_id=v.applicant_id))) then
    raise exception 'Applicant command scope mismatch'; end if;
  return new;
end; $$;
create trigger applicant_command_binding before insert or update on public.application_applicant_commands for each row execute function public.guard_applicant_command();

create function public.portal_response_upload_context(p_token_hash text,p_application_id uuid,p_revision integer,p_request_id uuid,p_document_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare s record; a public.applications;
begin
  select * into s from public.lock_voucher_portal_scope(p_token_hash,true);
  if p_application_id is null or p_application_id is distinct from s.application_id or p_request_id is null or p_document_id is null then raise exception 'Application unavailable'; end if;
  select * into a from public.applications where id=s.application_id for update;
  if a.status<>'additional_information_required' or a.submitted_at is null then raise exception 'Response unavailable'; end if;
  if p_revision is distinct from a.revision then raise exception 'Revision conflict'; end if;
  if exists(select 1 from public.application_applicant_commands where request_id=p_request_id) then raise exception 'Request already completed'; end if;
  return coalesce(a.user_id,a.applicant_id)::text||'/'||a.id::text||'/responses/'||p_request_id::text||'/'||p_document_id::text;
end; $$;

create function public.submit_portal_response(p_token_hash text,p_application_id uuid,p_revision integer,p_request_id uuid,p_body text,p_documents jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s record; a public.applications; previous public.application_applicant_commands; d jsonb; path text; doc_id uuid;
begin
  select * into s from public.lock_voucher_portal_scope(p_token_hash,true);
  if p_application_id is null or p_application_id is distinct from s.application_id or p_request_id is null or p_revision is null or p_revision<0
    or p_body is null or length(btrim(p_body)) not between 10 and 4000
    or p_documents is null or jsonb_typeof(p_documents)<>'array' then raise exception 'Invalid response'; end if;
  if jsonb_array_length(p_documents)>5 then raise exception 'Invalid response documents'; end if;
  select * into a from public.applications where id=s.application_id for update;
  select * into previous from public.application_applicant_commands where request_id=p_request_id;
  if found then
    if previous.application_id<>a.id or previous.voucher_access_id<>s.access_id or previous.operation<>'response'
      or previous.expected_revision<>p_revision or previous.body<>btrim(p_body) or previous.documents<>p_documents then raise exception 'Request conflict'; end if;
    return jsonb_build_object('revision',previous.result_revision,'status',previous.result_status,'replayed',true);
  end if;
  if a.status<>'additional_information_required' or a.submitted_at is null then raise exception 'Response unavailable'; end if;
  if p_revision<>a.revision then raise exception 'Revision conflict'; end if;
  if (select count(*) from public.application_documents where application_id=a.id)+jsonb_array_length(p_documents)>50 then raise exception 'Document limit reached'; end if;
  for d in select value from jsonb_array_elements(p_documents) loop
    if jsonb_typeof(d)<>'object' or not(d ?& array['id','name','mime','size']) or (d-array['id','name','mime','size'])<>'{}'::jsonb
      or coalesce(length(d->>'name'),0) not between 1 and 200 or (d->>'name') ~ '[[:cntrl:]/\\]'
      or (d->>'mime') is null or (d->>'mime') not in ('application/pdf','image/png','image/jpeg')
      or (d->>'size') is null or (d->>'size')::integer not between 1 and 10485760 then raise exception 'Invalid response document'; end if;
    doc_id := (d->>'id')::uuid;
    if doc_id is null then raise exception 'Invalid document identity'; end if;
    path := coalesce(a.user_id,a.applicant_id)::text||'/'||a.id::text||'/responses/'||p_request_id::text||'/'||doc_id::text;
    if not exists(select 1 from storage.objects where bucket_id='application-documents' and name=path and metadata->>'mimetype'=d->>'mime' and (metadata->>'size')::bigint=(d->>'size')::integer) then raise exception 'Uploaded object missing or metadata mismatch'; end if;
    insert into public.application_documents(id,application_id,user_id,applicant_id,kind,name,storage_path,mime_type,size_bytes)
      values(doc_id,a.id,a.user_id,a.applicant_id,'supporting',d->>'name',path,d->>'mime',(d->>'size')::integer);
  end loop;
  insert into public.application_applicant_commands(request_id,application_id,voucher_access_id,expected_revision,operation,body,documents,result_revision,result_status)
    values(p_request_id,a.id,s.access_id,p_revision,'response',btrim(p_body),p_documents,p_revision+1,'under_review');
  update public.applications set status='under_review',revision=revision+1,updated_at=clock_timestamp() where id=a.id;
  insert into public.application_status_history(application_id,status,message,actor_applicant_id)
    values(a.id,'under_review','Applicant supplied additional information for CruiseApply review.',s.principal_id);
  insert into public.notifications(user_id,applicant_id,title,body,href)
    values(a.user_id,a.applicant_id,'Response received','Your additional information was received for CruiseApply review.','/dashboard/applications/'||a.id::text);
  insert into public.audit_logs(actor_applicant_id,action,target_type,target_id,metadata)
    values(s.principal_id,'applicant_response_submitted','applications',a.id::text,jsonb_build_object('request_id',p_request_id,'from_revision',p_revision,'to_revision',p_revision+1,'document_count',jsonb_array_length(p_documents)));
  return jsonb_build_object('revision',p_revision+1,'status','under_review','replayed',false);
end; $$;

create function public.withdraw_portal_application(p_token_hash text,p_application_id uuid,p_revision integer,p_request_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s record; a public.applications; previous public.application_applicant_commands;
begin
  -- Withdrawal is the applicant's decision, including when paid entitlement is revoked.
  -- A valid, non-revoked access session and exact application ownership are still required.
  select * into s from public.lock_voucher_portal_scope(p_token_hash,false);
  if p_application_id is null or p_application_id is distinct from s.application_id or p_request_id is null or p_revision is null or p_revision<0
    or p_reason is null or length(btrim(p_reason)) not between 10 and 4000 then raise exception 'Invalid withdrawal'; end if;
  select * into a from public.applications where id=s.application_id for update;
  select * into previous from public.application_applicant_commands where request_id=p_request_id;
  if found then
    if previous.application_id<>a.id or previous.voucher_access_id<>s.access_id or previous.operation<>'withdraw'
      or previous.expected_revision<>p_revision or previous.body<>btrim(p_reason) then raise exception 'Request conflict'; end if;
    return jsonb_build_object('revision',previous.result_revision,'status',previous.result_status,'replayed',true);
  end if;
  if a.status in ('accepted','unsuccessful','withdrawn') then raise exception 'Application is terminal'; end if;
  if p_revision<>a.revision then raise exception 'Revision conflict'; end if;
  insert into public.application_applicant_commands(request_id,application_id,voucher_access_id,expected_revision,operation,body,result_revision,result_status)
    values(p_request_id,a.id,s.access_id,p_revision,'withdraw',btrim(p_reason),p_revision+1,'withdrawn');
  update public.applications set status='withdrawn',revision=revision+1,updated_at=clock_timestamp() where id=a.id;
  insert into public.application_status_history(application_id,status,message,actor_applicant_id)
    values(a.id,'withdrawn','Withdrawn by the applicant. '||btrim(p_reason),s.principal_id);
  insert into public.notifications(user_id,applicant_id,title,body,href)
    values(a.user_id,a.applicant_id,'Application withdrawn','Your request to withdraw this application was recorded.','/dashboard/applications/'||a.id::text);
  insert into public.audit_logs(actor_applicant_id,action,target_type,target_id,metadata)
    values(s.principal_id,'application_withdrawn_by_applicant','applications',a.id::text,jsonb_build_object('request_id',p_request_id,'from_status',a.status,'from_revision',p_revision,'to_revision',p_revision+1));
  return jsonb_build_object('revision',p_revision+1,'status','withdrawn','replayed',false);
end; $$;

create function public.load_portal_responses(p_token_hash text,p_application_id uuid,p_page integer default 1)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s record;
begin
  select * into s from public.lock_voucher_portal_scope(p_token_hash,false);
  if p_application_id is distinct from s.application_id or p_application_id is null or p_page is null or p_page not between 1 and 10000 then raise exception 'Application unavailable'; end if;
  return jsonb_build_object('total',(select count(*) from public.application_applicant_commands where application_id=s.application_id and voucher_access_id=s.access_id),
    'items',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.request_id desc) from (
      select request_id,operation,body,documents,created_at from public.application_applicant_commands where application_id=s.application_id and voucher_access_id=s.access_id
      order by created_at desc,request_id desc limit 20 offset (p_page-1)*20) r),'[]'::jsonb));
end; $$;

revoke all on function public.guard_applicant_command() from public,anon,authenticated,service_role;
revoke all on function public.portal_response_upload_context(text,uuid,integer,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.submit_portal_response(text,uuid,integer,uuid,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.withdraw_portal_application(text,uuid,integer,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.load_portal_responses(text,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.portal_response_upload_context(text,uuid,integer,uuid,uuid) to service_role;
grant execute on function public.submit_portal_response(text,uuid,integer,uuid,text,jsonb) to service_role;
grant execute on function public.withdraw_portal_application(text,uuid,integer,uuid,text) to service_role;
grant execute on function public.load_portal_responses(text,uuid,integer) to service_role;
commit;

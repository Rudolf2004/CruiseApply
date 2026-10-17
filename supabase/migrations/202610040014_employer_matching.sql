-- REVIEW ONLY: staff employer/matching operations and voucher-scoped consent.
-- Apply after 0013. No existing business rows updated; no external data sent.
begin;
alter table public.employers add column revision integer not null default 0 check(revision>=0);
alter table public.employer_opportunities add column revision integer not null default 0 check(revision>=0);
alter table public.employer_opportunities add column recipient_email text check(recipient_email is null or length(btrim(recipient_email)) between 3 and 254);
alter table public.application_matches add column revision integer not null default 0 check(revision>=0);
alter table public.application_matches add column consent_state text not null default 'none' check(consent_state in ('none','pending','granted','declined','revoked'));
alter table public.application_matches add column consent_scope jsonb;
alter table public.application_matches add column consent_principal_id uuid references public.applicant_principals;
alter table public.application_matches add constraint match_consent_binding check(
 (consent_state='none' and consent_scope is null and consent_principal_id is null) or
 (consent_state='pending' and consent_scope is not null and jsonb_typeof(consent_scope)='object' and consent_principal_id is null) or
 (consent_state in ('granted','declined') and consent_scope is not null and jsonb_typeof(consent_scope)='object' and consent_principal_id is not null) or
 (consent_state='revoked' and consent_scope is not null and jsonb_typeof(consent_scope)='object'));
create index match_consent_principal on public.application_matches(consent_principal_id) where consent_principal_id is not null;
create table public.matching_commands (
 request_id uuid primary key, actor_id uuid references public.profiles, actor_applicant_id uuid references public.applicant_principals,
 operation text not null, payload jsonb not null, result jsonb not null, created_at timestamptz not null default now(),
 check((actor_id is not null)<>(actor_applicant_id is not null))
);
alter table public.matching_commands enable row level security;
revoke all on public.matching_commands from public,anon,authenticated,service_role;
grant select,insert,delete on public.matching_commands to service_role;
grant select on public.matching_commands to authenticated;
create policy matching_commands_staff_read on public.matching_commands for select to authenticated using(public.is_admin());
create index matching_commands_staff on public.matching_commands(actor_id) where actor_id is not null;
create index matching_commands_applicant on public.matching_commands(actor_applicant_id) where actor_applicant_id is not null;

create function public.guard_match_identity() returns trigger language plpgsql set search_path='' as $$
begin
 if new.id is distinct from old.id or new.application_id is distinct from old.application_id
  or new.employer_opportunity_id is distinct from old.employer_opportunity_id or new.created_by is distinct from old.created_by
  or new.created_at is distinct from old.created_at then raise exception 'Match identity is immutable'; end if;
 return new;
end; $$;
create trigger match_identity before update on public.application_matches for each row execute function public.guard_match_identity();

-- Session-derived staff actor only. Retry serialization precedes entity locks.
create function public.manage_matching(p_request_id uuid,p_actor_id uuid,p_operation text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.matching_commands; role public.app_role; e public.employers; o public.employer_opportunities;
 m public.application_matches; a public.applications; result jsonb; entity uuid; expected integer; message text; next_status text; scope jsonb; docs jsonb; candidate uuid;
begin
 if p_request_id is null or p_actor_id is null or p_data is null or jsonb_typeof(p_data)<>'object'
  or p_operation is null or p_operation not in ('employer_save','opportunity_save','match_create','match_status','consent_request','referral_record') then raise exception 'Invalid matching request'; end if;
 select p.role into role from public.profiles p where id=p_actor_id for share;
 if not found or role not in ('admin','super_admin') then raise exception 'Administrator required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('staff-matching:'||p_request_id::text,0));
 select * into prior from public.matching_commands where request_id=p_request_id;
 if found then
  if prior.actor_id is distinct from p_actor_id or prior.operation<>p_operation or prior.payload<>p_data then raise exception 'Request conflict'; end if;
  return prior.result||jsonb_build_object('replayed',true);
 end if;
 entity := (p_data->>'id')::uuid; expected := (p_data->>'revision')::integer;
 if entity is null or expected is null or expected<0 then raise exception 'Invalid revision'; end if;
 if p_operation='employer_save' then
  if coalesce(length(btrim(p_data->>'name')),0) not between 2 and 200 or coalesce(p_data->>'website','') !~ '^https://[^[:space:]]+$' then raise exception 'Invalid employer'; end if;
  select * into e from public.employers where id=entity for update;
  if found then
   if e.revision<>expected then raise exception 'Revision conflict'; end if;
   update public.employers set name=btrim(p_data->>'name'),website=p_data->>'website',revision=revision+1 where id=entity returning * into e;
  else
   if expected<>0 then raise exception 'Revision conflict'; end if;
   insert into public.employers(id,name,website,revision) values(entity,btrim(p_data->>'name'),p_data->>'website',1) returning * into e;
  end if;
  result:=jsonb_build_object('id',e.id,'revision',e.revision);
 elsif p_operation='opportunity_save' then
  select * into e from public.employers where id=(p_data->>'employerId')::uuid for share;
  if not found then raise exception 'Employer unavailable'; end if;
  if coalesce(length(btrim(p_data->>'title')),0) not between 2 and 200 or coalesce(p_data->>'sourceUrl','') !~ '^https://[^[:space:]]+$'
   or coalesce(p_data->>'status','') not in ('research','verified','closed') or jsonb_typeof(p_data->'authorized') is distinct from 'boolean' then raise exception 'Invalid opportunity'; end if;
  if p_data->>'status'='verified' and ((p_data->>'checkedAt')::timestamptz is null or (p_data->>'checkedAt')::timestamptz>clock_timestamp()) then raise exception 'Source verification required'; end if;
  if (p_data->>'authorized')::boolean and (coalesce(length(btrim(p_data->>'evidence')),0) not between 10 and 2000
   or coalesce(p_data->>'recipient','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'Referral authorization required'; end if;
  select * into o from public.employer_opportunities where id=entity for update;
  if found then
   if o.revision<>expected or o.employer_id<>e.id then raise exception 'Revision conflict'; end if;
   update public.employer_opportunities set title=btrim(p_data->>'title'),source_url=p_data->>'sourceUrl',source_checked_at=(p_data->>'checkedAt')::timestamptz,
    status=p_data->>'status',referral_authorized=(p_data->>'authorized')::boolean,authorization_evidence=nullif(p_data->>'evidence',''),recipient_email=nullif(p_data->>'recipient',''),revision=revision+1,updated_at=clock_timestamp() where id=entity returning * into o;
  else
   if expected<>0 then raise exception 'Revision conflict'; end if;
   insert into public.employer_opportunities(id,employer_id,title,source_url,source_checked_at,status,referral_authorized,authorization_evidence,recipient_email,revision)
    values(entity,e.id,btrim(p_data->>'title'),p_data->>'sourceUrl',(p_data->>'checkedAt')::timestamptz,p_data->>'status',(p_data->>'authorized')::boolean,nullif(p_data->>'evidence',''),nullif(p_data->>'recipient',''),1) returning * into o;
  end if;
  result:=jsonb_build_object('id',o.id,'revision',o.revision);
 else
  message:=btrim(p_data->>'message');
  if coalesce(length(message),0) not between 10 and 2000 then raise exception 'Applicant-visible message required'; end if;
  if p_operation='match_create' then
   select * into a from public.applications where id=(p_data->>'applicationId')::uuid for update;
  else
   select application_id into candidate from public.application_matches where id=entity;
   select * into a from public.applications where id=candidate for update;
  end if;
  if not found then raise exception 'Application unavailable'; end if;
  if p_operation='match_create' then
   if a.status<>'accepted' or a.submitted_at is null or expected<>0 then raise exception 'Internal qualification required'; end if;
   select * into o from public.employer_opportunities where id=(p_data->>'opportunityId')::uuid;
  else
   select * into m from public.application_matches where id=entity for update;
   if not found or m.revision<>expected then raise exception 'Revision conflict'; end if;
   select * into o from public.employer_opportunities where id=m.employer_opportunity_id;
  end if;
  if o.id is null then raise exception 'Employer opportunity unavailable'; end if;
  -- Employer before opportunity matches the opportunity editor lock order.
  select * into e from public.employers where id=o.employer_id for share;
  select * into o from public.employer_opportunities where id=o.id for share;
  if p_operation='match_create' then
   if o.status<>'verified' or o.source_checked_at is null then raise exception 'Verified opportunity required'; end if;
   insert into public.application_matches(id,application_id,employer_opportunity_id,created_by,revision) values(entity,a.id,o.id,p_actor_id,1) returning * into m;
  elsif p_operation='match_status' then
   next_status:=p_data->>'status';
   if next_status is null or not((m.status='proposed' and next_status='qualified') or (m.status='qualified' and next_status='shortlisted') or (m.status<>'closed' and next_status='closed')) then raise exception 'Match transition unavailable'; end if;
   if next_status<>'closed' and (a.status<>'accepted' or o.status<>'verified') then raise exception 'Qualification or opportunity unavailable'; end if;
   update public.application_matches set status=next_status,revision=revision+1,updated_at=clock_timestamp(),consent_state=case when next_status='closed' and consent_state in ('pending','granted') then 'revoked' else consent_state end where id=m.id returning * into m;
  elsif p_operation='consent_request' then
   if a.status<>'accepted' or m.status<>'shortlisted' or o.status<>'verified' or not o.referral_authorized or o.recipient_email is null then raise exception 'Authorized referral opportunity required'; end if;
   docs:=p_data->'documentIds';
   if docs is null or jsonb_typeof(docs)<>'array' then raise exception 'Invalid document scope'; end if;
   if jsonb_array_length(docs)>20 or (select count(distinct value) from jsonb_array_elements_text(docs))<>jsonb_array_length(docs) then raise exception 'Invalid document scope'; end if;
   if exists(select 1 from jsonb_array_elements_text(docs) d where not exists(select 1 from public.application_documents x where x.id=d.value::uuid and x.application_id=a.id)) then raise exception 'Foreign document scope'; end if;
   scope:=jsonb_build_object('employer',e.name,'website',e.website,'title',o.title,'recipient',o.recipient_email,'sourceUrl',o.source_url,'employerRevision',e.revision,'opportunityRevision',o.revision,
    'applicationRevision',a.revision,'profileFields',jsonb_build_array('name','email','phone','nationality','country_of_residence','education','experience'),
    'documents',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'name',x.name) order by x.id) from public.application_documents x where x.application_id=a.id and x.id in(select value::uuid from jsonb_array_elements_text(docs))),'[]'::jsonb));
   update public.application_matches set consent_state='pending',consent_scope=scope,consent_principal_id=null,revision=revision+1,updated_at=clock_timestamp() where id=m.id returning * into m;
  elsif p_operation='referral_record' then
   if a.status<>'accepted' or m.status<>'shortlisted' or m.consent_state<>'granted' or m.consent_principal_id is null
    or o.status<>'verified' or not o.referral_authorized or m.consent_scope->>'recipient' is distinct from o.recipient_email
    or (m.consent_scope->>'applicationRevision')::integer is distinct from a.revision or (m.consent_scope->>'employerRevision')::integer is distinct from e.revision or (m.consent_scope->>'opportunityRevision')::integer is distinct from o.revision
    or coalesce(length(btrim(p_data->>'evidence')),0) not between 10 and 2000 then raise exception 'Current consent and recorded referral evidence required'; end if;
   update public.application_matches set status='referred',revision=revision+1,updated_at=clock_timestamp() where id=m.id returning * into m;
  end if;
  result:=jsonb_build_object('id',m.id,'revision',m.revision,'status',m.status,'consentState',m.consent_state);
  -- Consent/referral/closure updates only; internal proposed matches are not exposed.
  if m.consent_scope is not null then
   insert into public.notifications(user_id,applicant_id,title,body,href) values(a.user_id,a.applicant_id,'Employer matching update',message,'/dashboard/applications/'||a.id::text);
  end if;
 end if;
 insert into public.matching_commands(request_id,actor_id,operation,payload,result) values(p_request_id,p_actor_id,p_operation,p_data,result);
 insert into public.audit_logs(actor_id,action,target_type,target_id,metadata) values(p_actor_id,'matching_'||p_operation,'matching',entity::text,jsonb_build_object('request_id',p_request_id,'revision',result->'revision'));
 return result||jsonb_build_object('replayed',false);
end; $$;

create function public.decide_portal_match_consent(p_token_hash text,p_match_id uuid,p_revision integer,p_request_id uuid,p_choice text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s record; a public.applications; m public.application_matches; o public.employer_opportunities; e public.employers; prior public.matching_commands; payload jsonb; result jsonb;
begin
 select * into s from public.lock_voucher_portal_scope(p_token_hash,false);
 if s.application_id is null or p_match_id is null or p_revision is null or p_request_id is null or p_choice is null or p_choice not in ('granted','declined','revoked') then raise exception 'Invalid consent decision'; end if;
 select * into a from public.applications where id=s.application_id for update;
 select * into m from public.application_matches where id=p_match_id and application_id=a.id for update;
 if not found then raise exception 'Match unavailable'; end if;
 payload:=jsonb_build_object('matchId',p_match_id,'revision',p_revision,'choice',p_choice);
 select * into prior from public.matching_commands where request_id=p_request_id;
 if found then
  if prior.actor_applicant_id is distinct from s.principal_id or prior.operation<>'consent_decision' or prior.payload<>payload then raise exception 'Request conflict'; end if;
  return prior.result||jsonb_build_object('replayed',true);
 end if;
 if m.revision<>p_revision then raise exception 'Revision conflict'; end if;
 if not((m.consent_state='pending' and p_choice in ('granted','declined')) or (m.consent_state='granted' and p_choice='revoked')) then raise exception 'Consent decision unavailable'; end if;
 if p_choice='granted' then
  select * into o from public.employer_opportunities where id=m.employer_opportunity_id;
  select * into e from public.employers where id=o.employer_id for share;
  select * into o from public.employer_opportunities where id=m.employer_opportunity_id for share;
  if a.status<>'accepted' or m.status<>'shortlisted' or o.status<>'verified' or not o.referral_authorized
    or m.consent_scope->>'recipient' is distinct from o.recipient_email
    or (m.consent_scope->>'applicationRevision')::integer is distinct from a.revision or (m.consent_scope->>'employerRevision')::integer is distinct from e.revision or (m.consent_scope->>'opportunityRevision')::integer is distinct from o.revision then raise exception 'Consent request changed'; end if;
 end if;
 update public.application_matches set consent_state=p_choice,consent_principal_id=s.principal_id,revision=revision+1,updated_at=clock_timestamp() where id=m.id returning * into m;
 result:=jsonb_build_object('id',m.id,'revision',m.revision,'consentState',m.consent_state);
 insert into public.matching_commands(request_id,actor_applicant_id,operation,payload,result) values(p_request_id,s.principal_id,'consent_decision',payload,result);
 insert into public.audit_logs(actor_applicant_id,action,target_type,target_id,metadata) values(s.principal_id,'match_consent_'||p_choice,'application_matches',m.id::text,jsonb_build_object('request_id',p_request_id,'revision',m.revision));
 insert into public.notifications(user_id,applicant_id,title,body,href) values(a.user_id,a.applicant_id,'Referral consent updated','Your employer-specific consent decision was recorded. Revocation stops future sharing; it cannot recall information already received externally.','/dashboard/applications/'||a.id::text);
 return result||jsonb_build_object('replayed',false);
end; $$;

create function public.load_portal_matches(p_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s record;
begin
 select * into s from public.lock_voucher_portal_scope(p_token_hash,false);
 return coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'revision',m.revision,'status',m.status,'consentState',m.consent_state,'scope',m.consent_scope) order by m.created_at,m.id)
   from public.application_matches m where m.application_id=s.application_id and m.consent_scope is not null),'[]'::jsonb);
end; $$;
revoke all on function public.guard_match_identity() from public,anon,authenticated,service_role;
revoke all on function public.manage_matching(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.decide_portal_match_consent(text,uuid,integer,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.load_portal_matches(text) from public,anon,authenticated,service_role;
grant execute on function public.manage_matching(uuid,uuid,text,jsonb) to service_role;
grant execute on function public.decide_portal_match_consent(text,uuid,integer,uuid,text) to service_role;
grant execute on function public.load_portal_matches(text) to service_role;
commit;

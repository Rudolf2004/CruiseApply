-- REVIEW ONLY: run manually after applied migrations 0001-0005.
-- Adds atomic internal screening decisions. No existing application is changed.
-- No employer referral, match, payment or voucher mutation is enabled.
begin;

create table public.application_review_commands (
  request_id uuid primary key,
  application_id uuid not null references public.applications,
  actor_id uuid not null references public.profiles,
  expected_revision integer not null check(expected_revision >= 0),
  next_status public.application_status not null,
  applicant_message text not null check(length(btrim(applicant_message)) between 10 and 2000),
  result_revision integer not null,
  created_at timestamptz not null default now()
);
alter table public.application_review_commands enable row level security;
revoke all on public.application_review_commands from public,anon,authenticated;
grant select,insert on public.application_review_commands to service_role;

create function public.review_application(
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
  insert into public.notifications(user_id,title,body,href)
    values(application.user_id,'Application update',
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

revoke all on function public.review_application(uuid,uuid,uuid,integer,public.application_status,text)
  from public,anon,authenticated;
grant execute on function public.review_application(uuid,uuid,uuid,integer,public.application_status,text)
  to service_role;
commit;

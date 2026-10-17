-- REVIEW ONLY: additive migration after applied 0001-0006. Do not auto-apply.
-- Internal staff notes only; no application status or applicant notification changes.
begin;
alter table public.admin_notes add column context_revision integer check(context_revision >= 0);

create function public.add_application_note(
  p_request_id uuid,p_actor_id uuid,p_application_id uuid,p_revision integer,p_body text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare staff_role public.app_role; application public.applications; existing public.admin_notes;
begin
  if p_request_id is null or p_actor_id is null or p_application_id is null
    or p_revision is null or p_revision < 0 or p_body is null
    or length(btrim(p_body)) not between 10 and 5000 then
    raise exception 'Invalid note parameters';
  end if;
  select role into staff_role from public.profiles where id = p_actor_id for share;
  if not found or staff_role not in ('admin','super_admin') then raise exception 'Administrator required'; end if;
  select * into application from public.applications where id = p_application_id for update;
  if not found then raise exception 'Application not found'; end if;
  select * into existing from public.admin_notes where id = p_request_id;
  if found then
    if existing.application_id is distinct from p_application_id
      or existing.actor_id is distinct from p_actor_id
      or existing.context_revision is distinct from p_revision
      or existing.body is distinct from btrim(p_body) then raise exception 'Note request conflict'; end if;
    return existing.id;
  end if;
  if application.revision <> p_revision then raise exception 'Revision conflict'; end if;
  insert into public.admin_notes(id,application_id,actor_id,body,context_revision)
    values(p_request_id,p_application_id,p_actor_id,btrim(p_body),p_revision);
  -- Preserve the foundation's generic insert audit; add a staff-attributed event.
  -- No note body is duplicated into audit metadata.
  insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
    values(p_actor_id,'application_note_added','admin_notes',p_request_id::text,
      jsonb_build_object('application_id',p_application_id,'context_revision',p_revision,'request_id',p_request_id));
  return p_request_id;
end; $$;
revoke all on function public.add_application_note(uuid,uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.add_application_note(uuid,uuid,uuid,integer,text) to service_role;
commit;

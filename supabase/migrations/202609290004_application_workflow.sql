-- REVIEW AND APPLY MANUALLY after migrations 0001-0003. No payment changes.
begin;

alter table public.applications add column revision integer not null default 0 check (revision >= 0);
alter table public.application_education add column sort_order integer not null default 0;
alter table public.application_experience add column sort_order integer not null default 0;
-- Required document kinds are per-vacancy business configuration; none invented.
alter table public.jobs add column required_documents text[] not null default '{}'
  check (required_documents <@ array['cv','passport','certificate','photo','supporting']::text[]);

-- All application mutations acquire the same parent row lock. Expected revision
-- prevents stale tabs, autosave responses, and upload/submission races overwriting work.
create function public.save_application_draft(p_user_id uuid, p_application_id uuid, p_revision integer, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.applications; item jsonb; ordinal integer;
begin
  select * into a from public.applications where id = p_application_id and user_id = p_user_id for update;
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

-- Register only after an authenticated server has validated and uploaded the file.
-- This operation and submission serialize on the application row.
create function public.register_application_document(p_user_id uuid, p_application_id uuid, p_revision integer,
  p_id uuid, p_kind text, p_name text, p_path text, p_mime text, p_size integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.applications;
begin
  select * into a from public.applications where id = p_application_id and user_id = p_user_id for update;
  if not found then raise exception 'Application unavailable'; end if;
  if a.status <> 'draft' then raise exception 'Application is read only'; end if;
  if p_revision is distinct from a.revision then raise exception 'Revision conflict'; end if;
  if p_kind is null or p_kind not in ('cv','passport','certificate','photo','supporting')
    or coalesce(length(p_name),0) not between 1 and 200
    or p_path is distinct from (p_user_id::text || '/' || a.id::text || '/' || p_id::text)
    then raise exception 'Invalid document'; end if;
  if (select count(*) from public.application_documents where application_id = a.id) >= 20 then
    raise exception 'Document limit reached'; end if;
  if not exists(select 1 from storage.objects where bucket_id = 'application-documents' and name = p_path)
    then raise exception 'Uploaded object missing'; end if;
  insert into public.application_documents(id,application_id,user_id,kind,name,storage_path,mime_type,size_bytes)
    values(p_id,a.id,p_user_id,p_kind,p_name,p_path,p_mime,p_size);
  update public.applications set revision = revision + 1, updated_at = clock_timestamp() where id = a.id returning * into a;
  return jsonb_build_object('revision',a.revision,'updatedAt',a.updated_at,'documentId',p_id);
end; $$;

-- Remove metadata first under lock; the server then removes the inaccessible object.
create function public.remove_application_document(p_user_id uuid, p_application_id uuid, p_revision integer, p_document_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.applications; path text;
begin
  select * into a from public.applications where id = p_application_id and user_id = p_user_id for update;
  if not found then raise exception 'Application unavailable'; end if;
  if a.status <> 'draft' then raise exception 'Application is read only'; end if;
  if p_revision is distinct from a.revision then raise exception 'Revision conflict'; end if;
  delete from public.application_documents where id = p_document_id and application_id = a.id and user_id = p_user_id
    returning storage_path into path;
  if not found then raise exception 'Document unavailable'; end if;
  update public.applications set revision = revision + 1, updated_at = clock_timestamp() where id = a.id returning * into a;
  return jsonb_build_object('revision',a.revision,'updatedAt',a.updated_at,'storagePath',path);
end; $$;

-- The server validates the complete saved form, then supplies its exact revision.
-- Checks dependent on mutable job/document data are repeated here under lock.
create function public.submit_application(p_user_id uuid, p_application_id uuid, p_revision integer, p_declaration boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.applications; j public.jobs; q jsonb; k text; dob date;
begin
  select * into a from public.applications where id = p_application_id and user_id = p_user_id for update;
  if not found then raise exception 'Application unavailable'; end if;
  if p_declaration is distinct from true then raise exception 'Declaration required'; end if;
  if a.submitted_at is not null then
    return jsonb_build_object('reference',a.reference,'submittedAt',a.submitted_at); end if;
  if a.status <> 'draft' then raise exception 'Application is read only'; end if;
  if p_revision is distinct from a.revision then raise exception 'Revision conflict'; end if;
  select * into j from public.jobs where id = a.job_id for share;
  if not found or j.status <> 'published' or j.sample or j.application_deadline <= now()
    then raise exception 'Vacancy is no longer open'; end if;
  if not exists(select 1 from public.vouchers v where v.id = a.voucher_id and v.user_id = p_user_id
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
  insert into public.application_status_history(application_id,status,message,actor_id)
    values(a.id,'submitted','Application submitted with applicant declaration.',p_user_id);
  insert into public.notifications(user_id,title,body,href)
    values(p_user_id,'Application submitted','Your application ' || a.reference || ' has been received.','/dashboard/applications/' || a.id::text);
  insert into public.audit_logs(actor_id,action,target_type,target_id)
    values(p_user_id,'application_submitted','applications',a.id::text);
  return jsonb_build_object('reference',a.reference,'submittedAt',a.submitted_at);
end; $$;

revoke all on function public.save_application_draft(uuid,uuid,integer,jsonb) from public,anon,authenticated;
revoke all on function public.register_application_document(uuid,uuid,integer,uuid,text,text,text,text,integer) from public,anon,authenticated;
revoke all on function public.remove_application_document(uuid,uuid,integer,uuid) from public,anon,authenticated;
revoke all on function public.submit_application(uuid,uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.save_application_draft(uuid,uuid,integer,jsonb) to service_role;
grant execute on function public.register_application_document(uuid,uuid,integer,uuid,text,text,text,text,integer) to service_role;
grant execute on function public.remove_application_document(uuid,uuid,integer,uuid) to service_role;
grant execute on function public.submit_application(uuid,uuid,integer,boolean) to service_role;
commit;

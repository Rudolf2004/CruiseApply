-- REVIEW ONLY: apply after 0014. No existing business-row DML or auth cutover.
begin;
alter table public.jobs add column admin_revision integer not null default 0 check(admin_revision>=0);
alter table public.voucher_types add column admin_revision integer not null default 0 check(admin_revision>=0);
create table public.administration_commands (
 request_id uuid primary key, actor_id uuid not null references public.profiles,
 operation text not null check(operation in ('intake_save','product_save')),
 payload jsonb not null, result jsonb not null, created_at timestamptz not null default now()
);
alter table public.administration_commands enable row level security;
revoke all on public.administration_commands from public,anon,authenticated,service_role;
grant select on public.administration_commands to authenticated;
grant select,insert,delete on public.administration_commands to service_role;
create policy administration_staff_read on public.administration_commands for select to authenticated using(public.is_admin());
create index administration_actor on public.administration_commands(actor_id);

create function public.save_administration_record(p_request_id uuid,p_actor_id uuid,p_operation text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles; command public.administration_commands; j public.jobs; product public.voucher_types;
 item_id uuid; rev integer; result jsonb; q jsonb; required text[];
begin
 select * into actor from public.profiles where id=p_actor_id for share;
 if not found or actor.role not in ('admin','super_admin') then raise exception 'Administrator required'; end if;
 if p_request_id is null or p_operation is null or p_operation not in ('intake_save','product_save')
   or jsonb_typeof(p_data) is distinct from 'object' or length(p_data::text)>50000 then raise exception 'Invalid configuration'; end if;
 perform pg_advisory_xact_lock(hashtextextended('administration:'||p_request_id::text,0));
 select * into command from public.administration_commands where request_id=p_request_id;
 if found then
  if command.actor_id<>p_actor_id or command.operation<>p_operation or command.payload is distinct from p_data then raise exception 'Request conflict'; end if;
  return command.result||jsonb_build_object('replayed',true);
 end if;
 item_id:=(p_data->>'id')::uuid; rev:=(p_data->>'revision')::integer;
 if item_id is null or rev is null or rev<0 or rev>=2147483647 then raise exception 'Invalid revision'; end if;
 if p_operation='product_save' then
  -- Pricing is an explicit super-admin operation. No currency or historical edits.
  if actor.role<>'super_admin' then raise exception 'Super administrator required'; end if;
  if p_data-array['id','revision','name','description','amount','validityDays','active']<>'{}'::jsonb
    or length(btrim(coalesce(p_data->>'name',''))) not between 2 and 200
    or length(btrim(coalesce(p_data->>'description',''))) not between 10 and 5000
    or jsonb_typeof(p_data->'active') is distinct from 'boolean'
    or coalesce(p_data->>'amount','') !~ '^[0-9]{1,9}$'
    or (p_data->>'amount')::integer not between 1 and 999999999
    or coalesce(p_data->>'validityDays','') !~ '^[0-9]{1,4}$'
    or (p_data->>'validityDays')::integer not between 1 and 1095 then raise exception 'Invalid product'; end if;
  select * into product from public.voucher_types where id=item_id for update;
  if not found or product.admin_revision<>rev or product.currency<>'GHS' then raise exception 'Stale product'; end if;
  update public.voucher_types set name=btrim(p_data->>'name'),description=btrim(p_data->>'description'),
   amount=(p_data->>'amount')::integer,validity_days=(p_data->>'validityDays')::integer,
   active=(p_data->>'active')::boolean,admin_revision=admin_revision+1 where id=item_id;
 else
  if p_data-array['id','revision','title','slug','category','department','summary','description','serviceDescription','location','status','requiredDocuments','questions']<>'{}'::jsonb
    or length(btrim(coalesce(p_data->>'title',''))) not between 2 and 200
    or coalesce(p_data->>'slug','') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(p_data->>'slug')>150
    or length(btrim(coalesce(p_data->>'category',''))) not between 2 and 150
    or length(btrim(coalesce(p_data->>'department',''))) not between 2 and 150
    or length(btrim(coalesce(p_data->>'location',''))) not between 2 and 200
    or length(btrim(coalesce(p_data->>'summary',''))) not between 10 and 1000
    or length(btrim(coalesce(p_data->>'description',''))) not between 10 and 10000
    or length(btrim(coalesce(p_data->>'serviceDescription',''))) not between 40 and 5000
    or coalesce(p_data->>'status','') not in ('draft','published','paused','closed','archived')
    or jsonb_typeof(p_data->'requiredDocuments') is distinct from 'array'
    or jsonb_typeof(p_data->'questions') is distinct from 'array' then raise exception 'Invalid managed intake'; end if;
  if jsonb_array_length(p_data->'questions')>50 or jsonb_array_length(p_data->'requiredDocuments')>5 then raise exception 'Too many requirements'; end if;
  select array_agg(value) into required from jsonb_array_elements_text(p_data->'requiredDocuments');required:=coalesce(required,'{}');
  if not required <@ array['cv','passport','certificate','photo','supporting']::text[] then raise exception 'Invalid documents'; end if;
  for q in select value from jsonb_array_elements(p_data->'questions') loop
   if jsonb_typeof(q) is distinct from 'object' or q-array['id','label','required']<>'{}'::jsonb
    or length(btrim(coalesce(q->>'id',''))) not between 1 and 100
    or length(btrim(coalesce(q->>'label',''))) not between 1 and 500
    or jsonb_typeof(q->'required') is distinct from 'boolean' then raise exception 'Invalid question'; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_data->'questions') x group by x->>'id' having count(*)>1) then raise exception 'Duplicate questions'; end if;
  select * into j from public.jobs where id=item_id for update;
  if found then
   if j.admin_revision<>rev or j.opportunity_type<>'managed' or j.company is not null or j.sample then raise exception 'Stale or non-managed intake'; end if;
   -- Changing intake requirements after an application exists requires a future
   -- versioning operation, rather than silently changing an applicant's contract.
   if exists(select 1 from public.applications where job_id=item_id) and
    (j.title is distinct from btrim(p_data->>'title') or j.slug is distinct from p_data->>'slug'
     or j.category is distinct from btrim(p_data->>'category') or j.department is distinct from btrim(p_data->>'department')
     or j.location is distinct from btrim(p_data->>'location') or j.summary is distinct from btrim(p_data->>'summary')
     or j.description is distinct from btrim(p_data->>'description') or j.service_description is distinct from btrim(p_data->>'serviceDescription')
     or j.required_documents is distinct from required or j.questions is distinct from p_data->'questions') then raise exception 'Intake has applications; only status may change'; end if;
   update public.jobs set title=btrim(p_data->>'title'),slug=p_data->>'slug',category=btrim(p_data->>'category'),department=btrim(p_data->>'department'),
    summary=btrim(p_data->>'summary'),description=btrim(p_data->>'description'),service_description=btrim(p_data->>'serviceDescription'),location=btrim(p_data->>'location'),
    status=(p_data->>'status')::public.job_status,required_documents=required,questions=p_data->'questions',updated_at=clock_timestamp(),admin_revision=admin_revision+1 where id=item_id;
  else
   if rev<>0 then raise exception 'Stale intake'; end if;
   insert into public.jobs(id,title,slug,category,department,summary,description,service_description,location,status,required_documents,questions,company,contract_duration,opportunity_type,admin_revision)
    values(item_id,btrim(p_data->>'title'),p_data->>'slug',btrim(p_data->>'category'),btrim(p_data->>'department'),btrim(p_data->>'summary'),btrim(p_data->>'description'),btrim(p_data->>'serviceDescription'),btrim(p_data->>'location'),(p_data->>'status')::public.job_status,required,p_data->'questions',null,'','managed',1);
  end if;
 end if;
 result:=jsonb_build_object('id',item_id,'revision',rev+1);
 insert into public.administration_commands(request_id,actor_id,operation,payload,result) values(p_request_id,p_actor_id,p_operation,p_data,result);
 insert into public.audit_logs(actor_id,action,target_type,target_id,metadata) values(p_actor_id,p_operation,case when p_operation='product_save' then 'voucher_types' else 'jobs' end,item_id::text,jsonb_build_object('request_id',p_request_id,'revision',rev+1));
 return result;
end; $$;
revoke all on function public.save_administration_record(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.save_administration_record(uuid,uuid,text,jsonb) to service_role;
commit;

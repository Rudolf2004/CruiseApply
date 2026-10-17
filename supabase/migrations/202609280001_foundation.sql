-- Reproducible foundation. Apply through Supabase migrations before enabling the app.
create extension if not exists pgcrypto with schema extensions;

create type public.app_role as enum ('applicant', 'admin', 'super_admin');
create type public.job_status as enum ('draft', 'published', 'paused', 'closed', 'archived');
create type public.application_status as enum ('draft', 'submitted', 'under_review', 'additional_information_required', 'shortlisted', 'interview', 'final_review', 'accepted', 'unsuccessful', 'withdrawn');
create type public.payment_status as enum ('initialized', 'pending', 'successful', 'failed', 'refunded');
create type public.voucher_status as enum ('pending_payment', 'unused', 'used', 'expired', 'cancelled', 'refunded');

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text not null default '', phone text,
  role public.app_role not null default 'applicant',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role in ('admin', 'super_admin'));
$$;
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, full_name) values (new.id, left(coalesce(new.raw_user_meta_data->>'full_name', ''), 200));
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create table public.jobs (
  id uuid primary key default gen_random_uuid(), title text not null, slug text not null unique,
  company text not null, category text not null, department text not null,
  summary text not null, description text not null,
  responsibilities text[] not null default '{}', requirements text[] not null default '{}',
  preferred_qualifications text[] not null default '{}', minimum_age integer check(minimum_age >= 16),
  experience_requirement text, education_requirement text, contract_duration text not null,
  salary_text text, currency text check(currency ~ '^[A-Z]{3}$'), location text not null,
  region text, application_deadline timestamptz, openings integer check(openings > 0),
  featured boolean not null default false, status public.job_status not null default 'draft',
  sample boolean not null default false, questions jsonb not null default '[]',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index jobs_public_index on public.jobs(status, featured, created_at desc);
create index jobs_filters_index on public.jobs(category, department, company, location);
create table public.voucher_types (
  id uuid primary key default gen_random_uuid(), name text not null, description text not null,
  amount integer not null check(amount > 0), currency text not null check(currency ~ '^[A-Z]{3}$'),
  validity_days integer not null default 365 check(validity_days between 1 and 1095), active boolean not null default false
);
create table public.payments (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles,
  provider text not null default 'paystack', reference text not null unique,
  voucher_type_id uuid not null references public.voucher_types, job_id uuid references public.jobs,
  amount integer not null check(amount > 0), currency text not null check(currency ~ '^[A-Z]{3}$'),
  status public.payment_status not null default 'initialized', customer_email text not null,
  customer_phone text, provider_id text, created_at timestamptz not null default now(), paid_at timestamptz
);
create sequence public.voucher_serial_seq;
create sequence public.application_reference_seq;
create table public.vouchers (
  id uuid primary key default gen_random_uuid(),
  serial text not null unique default ('CRV-' || extract(year from now())::text || '-' || lpad(nextval('public.voucher_serial_seq')::text, 8, '0')),
  user_id uuid not null references public.profiles, payment_id uuid not null unique references public.payments,
  voucher_type_id uuid not null references public.voucher_types, job_id uuid references public.jobs,
  pin_hash text not null, pin_encrypted text not null,
  status public.voucher_status not null default 'unused', purchased_at timestamptz not null default now(),
  activated_at timestamptz, expires_at timestamptz not null
);
create table public.applicants (
  id uuid primary key default gen_random_uuid(), user_id uuid not null unique references public.profiles,
  first_name text, middle_name text, surname text, date_of_birth date, nationality text,
  country_of_residence text, address text, updated_at timestamptz not null default now()
);
create table public.applications (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('APP-' || extract(year from now())::text || '-' || lpad(nextval('public.application_reference_seq')::text, 8, '0')),
  user_id uuid not null references public.profiles, job_id uuid not null references public.jobs,
  voucher_id uuid not null unique references public.vouchers,
  status public.application_status not null default 'draft', personal jsonb not null default '{}',
  identification jsonb not null default '{}', declaration_at timestamptz, submitted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.application_education (
  id uuid primary key default gen_random_uuid(), application_id uuid not null references public.applications on delete cascade,
  institution text not null, qualification text not null, field text, start_date date, completion_date date, country text,
  check(completion_date is null or start_date is null or completion_date >= start_date)
);
create table public.application_experience (
  id uuid primary key default gen_random_uuid(), application_id uuid not null references public.applications on delete cascade,
  employer text not null, position text not null, location text, start_date date, end_date date, responsibilities text,
  check(end_date is null or start_date is null or end_date >= start_date)
);
create table public.application_documents (
  id uuid primary key default gen_random_uuid(), application_id uuid not null references public.applications on delete cascade,
  user_id uuid not null references public.profiles, kind text not null, name text not null,
  storage_path text not null unique, mime_type text not null check(mime_type in ('application/pdf','image/jpeg','image/png')),
  size_bytes integer not null check(size_bytes between 1 and 10485760), created_at timestamptz not null default now()
);
create table public.application_answers (
  application_id uuid not null references public.applications on delete cascade, question_id text not null,
  answer text not null, primary key(application_id, question_id)
);
create table public.application_status_history (
  id uuid primary key default gen_random_uuid(), application_id uuid not null references public.applications,
  status public.application_status not null, message text, actor_id uuid references public.profiles,
  created_at timestamptz not null default now()
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles,
  title text not null, body text not null, href text, read_at timestamptz, created_at timestamptz not null default now()
);
create table public.admin_notes (
  id uuid primary key default gen_random_uuid(), application_id uuid not null references public.applications,
  actor_id uuid not null references public.profiles, body text not null, created_at timestamptz not null default now()
);
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(), actor_id uuid references public.profiles,
  action text not null, target_type text not null, target_id text not null,
  metadata jsonb not null default '{}', created_at timestamptz not null default now()
);
create table public.platform_settings (
  key text primary key, value jsonb not null, public boolean not null default false, updated_at timestamptz not null default now()
);
create index applications_owner_index on public.applications(user_id, created_at desc);
create index applications_status_index on public.applications(status, job_id);
create index payments_owner_index on public.payments(user_id, created_at desc);
create index vouchers_owner_index on public.vouchers(user_id);
create index notifications_owner_index on public.notifications(user_id, created_at desc);
create index history_application_index on public.application_status_history(application_id, created_at);
create index documents_application_index on public.application_documents(application_id);

-- Deny by default. Mutations with cross-row invariants go through narrowly scoped server operations.
do $$ declare t text; begin
  foreach t in array array['profiles','jobs','voucher_types','payments','vouchers','applicants','applications',
    'application_education','application_experience','application_documents','application_answers',
    'application_status_history','notifications','admin_notes','audit_logs','platform_settings']
  loop execute format('alter table public.%I enable row level security', t); end loop;
end $$;
create policy profiles_read on public.profiles for select to authenticated using(id = auth.uid() or public.is_admin());
-- Column grants prevent role escalation even through direct REST calls.
revoke update on public.profiles from authenticated;
grant update(full_name, phone) on public.profiles to authenticated;
create policy profiles_edit on public.profiles for update to authenticated using(id = auth.uid()) with check(id = auth.uid());
create policy jobs_read on public.jobs for select using(status = 'published' or public.is_admin());
create policy types_read on public.voucher_types for select using(active or public.is_admin());
create policy settings_read on public.platform_settings for select using(public or public.is_admin());
do $$ declare t text; begin
  foreach t in array array['payments','vouchers','applicants','applications','application_documents','notifications'] loop
    execute format('create policy owner_read on public.%I for select to authenticated using(user_id = auth.uid() or public.is_admin())', t);
  end loop;
  foreach t in array array['application_education','application_experience','application_answers','application_status_history'] loop
    execute format('create policy application_owner_read on public.%I for select to authenticated using(exists(select 1 from public.applications a where a.id = application_id and (a.user_id = auth.uid() or public.is_admin())))', t);
  end loop;
end $$;
create policy notes_admin_read on public.admin_notes for select to authenticated using(public.is_admin());
create policy audit_admin_read on public.audit_logs for select to authenticated using(public.is_admin());
-- Voucher credentials are never returned by the public API.
revoke select on public.vouchers from anon, authenticated;
grant select(id, serial, user_id, payment_id, voucher_type_id, job_id, status, purchased_at, activated_at, expires_at) on public.vouchers to authenticated;

create function public.audit_change() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_logs(actor_id, action, target_type, target_id)
  values(auth.uid(), lower(tg_op), tg_table_name, coalesce(to_jsonb(new)->>'id', to_jsonb(new)->>'key', to_jsonb(old)->>'id', to_jsonb(old)->>'key'));
  return coalesce(new, old);
end; $$;
do $$ declare t text; begin
  foreach t in array array['jobs','vouchers','admin_notes','platform_settings','profiles'] loop
    execute format('create trigger audit_mutation after insert or update or delete on public.%I for each row execute function public.audit_change()', t);
  end loop;
end $$;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values('application-documents', 'application-documents', false, 10485760, array['application/pdf','image/jpeg','image/png']);
-- Upload/download handled by authenticated server routes; no public object policies.

revoke all on function public.handle_new_user() from public;
revoke all on function public.audit_change() from public;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

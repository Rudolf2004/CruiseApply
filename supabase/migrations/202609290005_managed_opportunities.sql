-- REVIEW ONLY: apply manually after 0004. No opportunity is published here.
-- Existing jobs become research until explicitly classified by an administrator.
-- Payment verification, quotes, fulfillment and voucher credentials are untouched.
begin;

alter table public.jobs alter column company drop not null;
alter table public.jobs add column opportunity_type text not null default 'research'
  check (opportunity_type in ('managed','research'));
alter table public.jobs add column service_description text;
alter table public.jobs add column source_url text;
alter table public.jobs add column source_checked_at timestamptz;

-- Fail instead of silently unpublishing or reclassifying pre-existing public jobs.
-- Current verified state has no published jobs; researched Carnival rows are drafts.
alter table public.jobs add constraint published_managed_opportunity
  check (status <> 'published' or
    (opportunity_type = 'managed' and length(btrim(coalesce(service_description,''))) between 40 and 5000));
alter table public.jobs add constraint opportunity_source_https
  check (source_url is null or source_url ~ '^https://[^[:space:]]+$');

-- Record what the candidate's paid service covered when the application started.
-- Existing applications are not assigned invented historical service wording.
alter table public.applications add column opportunity_title_snapshot text;
alter table public.applications add column service_description_snapshot text;

create function public.guard_managed_application() returns trigger
language plpgsql security definer set search_path = '' as $$
declare opportunity public.jobs;
begin
  if tg_op = 'INSERT' then
    select * into opportunity from public.jobs where id = new.job_id for share;
    if not found or opportunity.opportunity_type <> 'managed'
      or opportunity.status <> 'published' or opportunity.sample
      or opportunity.application_deadline <= now() then
      raise exception 'Managed opportunity unavailable';
    end if;
    new.opportunity_title_snapshot := opportunity.title;
    new.service_description_snapshot := opportunity.service_description;
  else
    if new.user_id is distinct from old.user_id or new.job_id is distinct from old.job_id
      or new.voucher_id is distinct from old.voucher_id
      or new.opportunity_title_snapshot is distinct from old.opportunity_title_snapshot
      or new.service_description_snapshot is distinct from old.service_description_snapshot then
      raise exception 'Application ownership, opportunity and service snapshots are immutable';
    end if;
  end if;
  return new;
end; $$;
create trigger application_managed_boundary before insert or update on public.applications
  for each row execute function public.guard_managed_application();
revoke all on function public.guard_managed_application() from public,anon,authenticated;

-- Employer association is a later matching step, not a prerequisite to applying.
create table public.employers (
  id uuid primary key default gen_random_uuid(), name text not null check(length(btrim(name)) between 2 and 200),
  website text check(website is null or website ~ '^https://[^[:space:]]+$'),
  created_at timestamptz not null default now()
);
create table public.employer_opportunities (
  id uuid primary key default gen_random_uuid(), employer_id uuid not null references public.employers,
  title text not null check(length(btrim(title)) between 2 and 200),
  source_url text not null check(source_url ~ '^https://[^[:space:]]+$'),
  source_checked_at timestamptz,
  status text not null default 'research' check(status in ('research','verified','closed')),
  -- Research never implies permission to recruit or transmit candidate data.
  referral_authorized boolean not null default false,
  authorization_evidence text,
  check(not referral_authorized or length(btrim(coalesce(authorization_evidence,''))) >= 10),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.application_matches (
  id uuid primary key default gen_random_uuid(), application_id uuid not null references public.applications,
  employer_opportunity_id uuid not null references public.employer_opportunities,
  status text not null default 'proposed' check(status in ('proposed','qualified','shortlisted','referred','closed')),
  created_by uuid not null references public.profiles,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(application_id,employer_opportunity_id)
);
create index application_matches_application_index on public.application_matches(application_id);
create index employer_opportunities_employer_index on public.employer_opportunities(employer_id);

alter table public.employers enable row level security;
alter table public.employer_opportunities enable row level security;
alter table public.application_matches enable row level security;
revoke all on public.employers,public.employer_opportunities,public.application_matches from anon,authenticated;
grant select on public.employers,public.employer_opportunities,public.application_matches to authenticated;
grant all on public.employers,public.employer_opportunities,public.application_matches to service_role;
create policy employers_admin_read on public.employers for select to authenticated using(public.is_admin());
create policy employer_opportunities_admin_read on public.employer_opportunities for select to authenticated using(public.is_admin());
create policy application_matches_admin_read on public.application_matches for select to authenticated using(public.is_admin());
-- Candidate-visible matching updates and audited mutation RPCs belong to the
-- admin/matching phase. No referral endpoint or external data transmission enabled.

commit;

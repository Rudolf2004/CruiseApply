-- REVIEW ONLY. Apply manually after 0001-0007; no auth/RLS cutover here.
-- No business-row DML, backfill, credential rotation or Paystack operation.
begin;

create table public.applicant_principals (
  id uuid primary key default gen_random_uuid(),
  display_name text check (length(display_name) <= 200),
  created_at timestamptz not null default now(),
  disabled_at timestamptz
);

create table public.guest_checkouts (
  id uuid primary key default gen_random_uuid(),
  applicant_id uuid not null unique references public.applicant_principals,
  capability_hash text not null unique check (capability_hash ~ '^[a-f0-9]{64}$'),
  contact_email text not null check (length(btrim(contact_email)) between 3 and 254),
  contact_name text check (length(contact_name) <= 200),
  contact_phone text check (length(contact_phone) <= 40),
  country_code text not null references public.pricing_countries(code),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  unique (id, applicant_id),
  check (expires_at > created_at)
);

-- Capabilities cannot be reassigned to another principal/contact after creation.
create function public.guard_guest_checkout_binding() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - 'revoked_at') is distinct from (to_jsonb(old) - 'revoked_at') then
    raise exception 'Checkout capability and ownership are immutable';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'Revoked checkout cannot be restored';
  end if;
  return new;
end; $$;
create trigger guest_checkout_binding before update on public.guest_checkouts
  for each row execute function public.guard_guest_checkout_binding();
create index guest_checkout_country on public.guest_checkouts(country_code);

-- Keep legacy NOT NULL user_id constraints in this first expansion.
-- The XOR checks consequently require applicant_id to remain NULL on existing
-- tables until a separately reviewed activation migration removes NOT NULL.
do $$
declare t text;
begin
  foreach t in array array['payment_quotes','payments','vouchers','applicants',
    'applications','application_documents','notifications'] loop
    execute format('alter table public.%I add column applicant_id uuid references public.applicant_principals(id)', t);
    execute format('alter table public.%I add constraint %I check ((user_id is not null) <> (applicant_id is not null))', t, t || '_one_owner');
    execute format('create index %I on public.%I(applicant_id) where applicant_id is not null', t || '_principal_idx', t);
  end loop;
end; $$;
create unique index applicants_principal_unique on public.applicants(applicant_id) where applicant_id is not null;

alter table public.payment_quotes add column guest_checkout_id uuid;
alter table public.payment_quotes add constraint quote_checkout_owner
  foreign key (guest_checkout_id, applicant_id) references public.guest_checkouts(id, applicant_id);
alter table public.payment_quotes add constraint quote_checkout_requires_principal
  check (guest_checkout_id is null or applicant_id is not null);
alter table public.payments add column guest_checkout_id uuid;
alter table public.payments add constraint payment_checkout_owner
  foreign key (guest_checkout_id, applicant_id) references public.guest_checkouts(id, applicant_id);
alter table public.payments add constraint payment_checkout_requires_principal
  check (guest_checkout_id is null or applicant_id is not null);

create index quote_guest_checkout_idx on public.payment_quotes(guest_checkout_id, applicant_id) where guest_checkout_id is not null;
create index payment_guest_checkout_idx on public.payments(guest_checkout_id, applicant_id) where guest_checkout_id is not null;

-- Existing payment/quote immutability triggers already protect newly added fields.
-- Freeze both ownership forms on the other owner-bearing tables for future use.
create function public.guard_applicant_owner_identity() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.user_id is distinct from old.user_id
    or new.applicant_id is distinct from old.applicant_id then
    raise exception 'Record ownership is immutable';
  end if;
  return new;
end; $$;
do $$
declare t text;
begin
  foreach t in array array['vouchers','applicants','applications','application_documents','notifications'] loop
    execute format('create trigger preserve_applicant_owner before update on public.%I for each row execute function public.guard_applicant_owner_identity()', t);
  end loop;
end; $$;

create table public.voucher_access (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null unique references public.vouchers,
  applicant_id uuid not null unique references public.applicant_principals,
  legacy_user_id uuid references public.profiles,
  credential_state text not null check (credential_state in ('legacy','pending_delivery','current')),
  -- NULL means legacy-hash verification or no initial credential yet, never an empty PIN.
  pin_hash text,
  credential_version integer not null default 0 check (credential_version >= 0),
  credential_rotated_at timestamptz,
  created_at timestamptz not null default now(),
  suspended_at timestamptz,
  revoked_at timestamptz,
  check (
    (credential_state = 'legacy' and legacy_user_id is not null and pin_hash is null
      and credential_version = 0 and credential_rotated_at is null)
    or (credential_state = 'pending_delivery' and legacy_user_id is null and pin_hash is null
      and credential_version = 0 and credential_rotated_at is null)
    or (credential_state = 'current' and pin_hash is not null
      and pin_hash ~ '^s[12]:[a-f0-9]{32}:[a-f0-9]{64}$'
      and credential_version > 0 and credential_rotated_at is not null)
  )
);

create index voucher_access_legacy_owner on public.voucher_access(legacy_user_id) where legacy_user_id is not null;

-- Binding checks are ownership checks, NOT voucher-status authentication rules.
create function public.guard_voucher_access_binding() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v public.vouchers; p public.payments;
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.created_at is distinct from old.created_at
      or new.voucher_id is distinct from old.voucher_id or new.applicant_id is distinct from old.applicant_id
      or new.legacy_user_id is distinct from old.legacy_user_id then
      raise exception 'Voucher access binding is immutable';
    end if;
    if new.credential_version < old.credential_version then raise exception 'Credential version cannot decrease'; end if;
    if new.pin_hash is distinct from old.pin_hash or new.credential_state is distinct from old.credential_state then
      if new.credential_version <= old.credential_version or new.credential_state <> 'current' then
        raise exception 'Credential changes require forward rotation';
      end if;
    end if;
    if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
      raise exception 'Revoked access cannot be restored';
    end if;
  end if;
  select * into v from public.vouchers where id = new.voucher_id;
  select * into p from public.payments where id = v.payment_id;
  if v.id is null or p.id is null or v.user_id is distinct from p.user_id
    or v.applicant_id is distinct from p.applicant_id then raise exception 'Voucher ownership chain mismatch'; end if;
  if p.status not in ('successful','refunded') or p.paid_at is null then
    raise exception 'Voucher access requires a previously verified purchase';
  end if;
  if v.user_id is not null then
    if new.legacy_user_id is distinct from v.user_id or new.credential_state = 'pending_delivery' then
      raise exception 'Legacy voucher binding mismatch';
    end if;
  elsif new.applicant_id is distinct from v.applicant_id or new.legacy_user_id is not null
    or new.credential_state = 'legacy' then raise exception 'Applicant voucher binding mismatch'; end if;
  return new;
end; $$;
create trigger voucher_access_binding before insert or update on public.voucher_access
  for each row execute function public.guard_voucher_access_binding();

create table public.applicant_sessions (
  id uuid primary key default gen_random_uuid(),
  voucher_access_id uuid not null references public.voucher_access,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  credential_version integer not null check (credential_version >= 0),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  idle_expires_at timestamptz not null default (now() + interval '168 hours'),
  absolute_expires_at timestamptz not null default (now() + interval '720 hours'),
  revoked_at timestamptz,
  check (absolute_expires_at = created_at + interval '720 hours'),
  check (last_seen_at >= created_at and last_seen_at < absolute_expires_at),
  check (idle_expires_at = least(last_seen_at + interval '168 hours', absolute_expires_at))
);
create index applicant_sessions_access on public.applicant_sessions(voucher_access_id);
create index applicant_sessions_expiry on public.applicant_sessions(absolute_expires_at);
create function public.guard_applicant_session_bounds() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.id is distinct from old.id or new.voucher_access_id is distinct from old.voucher_access_id
    or new.token_hash is distinct from old.token_hash or new.credential_version is distinct from old.credential_version
    or new.created_at is distinct from old.created_at or new.absolute_expires_at is distinct from old.absolute_expires_at then
    raise exception 'Session identity and absolute lifetime are immutable';
  end if;
  if new.last_seen_at < old.last_seen_at then raise exception 'Session activity cannot move backwards'; end if;
  if new.last_seen_at is distinct from old.last_seen_at then
    if old.revoked_at is not null or old.idle_expires_at <= clock_timestamp()
      or old.absolute_expires_at <= clock_timestamp() or new.last_seen_at > clock_timestamp() then
      raise exception 'Inactive session cannot refresh activity';
    end if;
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'Revoked session cannot be restored';
  end if;
  return new;
end; $$;
create trigger applicant_session_bounds before update on public.applicant_sessions
  for each row execute function public.guard_applicant_session_bounds();

create table public.voucher_contacts (
  id uuid primary key default gen_random_uuid(),
  voucher_access_id uuid not null unique references public.voucher_access,
  -- Contact email is not an account, unique identity, or proof of ownership.
  email text not null check (length(btrim(email)) between 3 and 254),
  contact_version integer not null default 1 check (contact_version > 0),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, voucher_access_id)
);
create function public.guard_voucher_contact_binding() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.id is distinct from old.id or new.voucher_access_id is distinct from old.voucher_access_id
    or new.created_at is distinct from old.created_at then raise exception 'Contact binding is immutable'; end if;
  if new.contact_version < old.contact_version then raise exception 'Contact version cannot decrease'; end if;
  if new.email is distinct from old.email then
    if new.contact_version <= old.contact_version or new.verified_at is not null then
      raise exception 'Changed contact requires new verification';
    end if;
  end if;
  return new;
end; $$;
create trigger voucher_contact_binding before update on public.voucher_contacts
  for each row execute function public.guard_voucher_contact_binding();

create table public.voucher_contact_challenges (
  id uuid primary key default gen_random_uuid(),
  voucher_access_id uuid not null references public.voucher_access,
  contact_id uuid not null,
  contact_version integer not null check (contact_version > 0),
  purpose text not null check (purpose in ('verify_contact','reset_pin')),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  foreign key (contact_id, voucher_access_id) references public.voucher_contacts(id, voucher_access_id),
  check (expires_at > created_at)
);
create index voucher_challenges_access on public.voucher_contact_challenges(voucher_access_id);
create index voucher_challenges_contact on public.voucher_contact_challenges(contact_id, voucher_access_id);
create function public.guard_voucher_challenge_binding() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - array['consumed_at','revoked_at','failed_attempts'])
    is distinct from (to_jsonb(old) - array['consumed_at','revoked_at','failed_attempts']) then
    raise exception 'Challenge binding is immutable';
  end if;
  if new.failed_attempts < old.failed_attempts then raise exception 'Challenge attempts cannot decrease'; end if;
  if old.consumed_at is not null and new.consumed_at is distinct from old.consumed_at then raise exception 'Challenge consumed'; end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then raise exception 'Challenge revoked'; end if;
  return new;
end; $$;
create trigger voucher_challenge_binding before update on public.voucher_contact_challenges
  for each row execute function public.guard_voucher_challenge_binding();

-- Hash-only credential delivery: no PIN plaintext or PIN ciphertext column.
-- Claim must generate a NEW PIN and hash atomically in the future implementation.
-- Lost response requires verified rotation, never recovery of that same PIN.
create table public.voucher_credential_deliveries (
  id uuid primary key default gen_random_uuid(),
  voucher_access_id uuid not null unique references public.voucher_access,
  guest_checkout_id uuid not null unique references public.guest_checkouts,
  capability_hash text not null unique check (capability_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  check (expires_at > created_at)
);
create function public.guard_credential_delivery_binding() returns trigger
language plpgsql security definer set search_path = '' as $$
declare access_principal uuid; checkout_principal uuid;
begin
  select applicant_id into access_principal from public.voucher_access where id = new.voucher_access_id;
  select applicant_id into checkout_principal from public.guest_checkouts where id = new.guest_checkout_id;
  if access_principal is null or access_principal is distinct from checkout_principal then
    raise exception 'Credential delivery ownership mismatch';
  end if;
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.voucher_access_id is distinct from old.voucher_access_id or new.guest_checkout_id is distinct from old.guest_checkout_id
      or new.capability_hash is distinct from old.capability_hash or new.created_at is distinct from old.created_at
      or new.expires_at is distinct from old.expires_at then raise exception 'Credential delivery binding is immutable'; end if;
    if old.consumed_at is not null and new.consumed_at is distinct from old.consumed_at then raise exception 'Delivery already consumed'; end if;
    if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then raise exception 'Delivery revoked'; end if;
  end if;
  return new;
end; $$;
create trigger credential_delivery_binding before insert or update on public.voucher_credential_deliveries
  for each row execute function public.guard_credential_delivery_binding();

create table public.applicant_notification_links (
  notification_id uuid primary key references public.notifications,
  voucher_access_id uuid not null references public.voucher_access,
  application_id uuid references public.applications,
  payment_id uuid references public.payments,
  check ((application_id is not null) <> (payment_id is not null))
);
create index applicant_notification_access on public.applicant_notification_links(voucher_access_id);
create index applicant_notification_application on public.applicant_notification_links(application_id) where application_id is not null;
create index applicant_notification_payment on public.applicant_notification_links(payment_id) where payment_id is not null;
create function public.guard_applicant_notification_binding() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n public.notifications; a public.voucher_access; v public.vouchers; application_voucher uuid;
begin
  if tg_op = 'UPDATE' and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception 'Notification scope is immutable';
  end if;
  select * into n from public.notifications where id = new.notification_id;
  select * into a from public.voucher_access where id = new.voucher_access_id;
  select * into v from public.vouchers where id = a.voucher_id;
  if n.id is null or a.id is null or v.id is null then raise exception 'Notification scope unavailable'; end if;
  if n.user_id is not null then
    if n.user_id is distinct from a.legacy_user_id then raise exception 'Notification owner mismatch'; end if;
  elsif n.applicant_id is distinct from a.applicant_id then raise exception 'Notification owner mismatch'; end if;
  if new.application_id is not null then
    select voucher_id into application_voucher from public.applications where id = new.application_id;
    if application_voucher is distinct from v.id then raise exception 'Notification application mismatch'; end if;
  elsif new.payment_id is distinct from v.payment_id then raise exception 'Notification payment mismatch'; end if;
  return new;
end; $$;
create trigger applicant_notification_binding before insert or update on public.applicant_notification_links
  for each row execute function public.guard_applicant_notification_binding();

alter table public.application_status_history add column actor_applicant_id uuid references public.applicant_principals;
alter table public.application_status_history add constraint history_one_actor
  check (actor_id is null or actor_applicant_id is null);
alter table public.audit_logs add column actor_applicant_id uuid references public.applicant_principals;
alter table public.audit_logs add constraint audit_one_actor
  check (actor_id is null or actor_applicant_id is null);

create index history_applicant_actor on public.application_status_history(actor_applicant_id) where actor_applicant_id is not null;
create index audit_applicant_actor on public.audit_logs(actor_applicant_id) where actor_applicant_id is not null;

-- New tables are private scaffolding. Existing policies/grants are NOT replaced.
do $$
declare t text;
begin
  foreach t in array array['applicant_principals','guest_checkouts','voucher_access','applicant_sessions',
    'voucher_contacts','voucher_contact_challenges','voucher_credential_deliveries','applicant_notification_links'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end; $$;
revoke all on function public.guard_guest_checkout_binding() from public, anon, authenticated, service_role;
revoke all on function public.guard_applicant_owner_identity() from public, anon, authenticated, service_role;
revoke all on function public.guard_voucher_access_binding() from public, anon, authenticated, service_role;
revoke all on function public.guard_applicant_session_bounds() from public, anon, authenticated, service_role;
revoke all on function public.guard_voucher_contact_binding() from public, anon, authenticated, service_role;
revoke all on function public.guard_voucher_challenge_binding() from public, anon, authenticated, service_role;
revoke all on function public.guard_credential_delivery_binding() from public, anon, authenticated, service_role;
revoke all on function public.guard_applicant_notification_binding() from public, anon, authenticated, service_role;

-- Deliberately absent: INSERT/UPDATE/DELETE of business rows; legacy backfill;
-- changes to applied RPCs, PIN hash/ciphertext or existing RLS; new login RPCs.
commit;

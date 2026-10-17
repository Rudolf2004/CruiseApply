-- REVIEW ONLY: service-only session operations; apply manually after 0008.
-- No routes/auth cutover, ownership activation, backfill or business-row updates.
-- The trusted server MUST verify the supplied PIN using scrypt before opening
-- a session. p_verified_pin_hash is a locked proof binding, NOT a client input.
begin;

create function public.get_voucher_login_material(p_serial text)
returns table(voucher_id uuid, pin_hash text, credential_version integer)
language sql stable security definer set search_path = '' as $$
  select v.id,
    case when a.credential_state = 'current' then a.pin_hash else v.pin_hash end,
    coalesce(a.credential_version, 0)
  from public.vouchers v
  join public.payments p on p.id = v.payment_id
  left join public.voucher_access a on a.voucher_id = v.id
  left join public.applicant_principals principal on principal.id = a.applicant_id
  where v.serial = p_serial and length(p_serial) between 1 and 100
    and p.paid_at is not null and p.status in ('successful','refunded')
    and v.user_id is not distinct from p.user_id
    and v.applicant_id is not distinct from p.applicant_id
    and (a.id is null and v.user_id is not null
      or a.id is not null and a.credential_state in ('legacy','current')
        and a.revoked_at is null and a.suspended_at is null and principal.disabled_at is null);
$$;

create function public.open_verified_voucher_session(
  p_serial text, p_verified_pin_hash text, p_expected_credential_version integer,
  p_token_hash text
) returns table(session_id uuid, voucher_access_id uuid, applicant_id uuid,
  voucher_id uuid, idle_expires_at timestamptz, absolute_expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v public.vouchers; payment public.payments; access_row public.voucher_access;
  principal public.applicant_principals; session_row public.applicant_sessions;
  authoritative_hash text; at_time timestamptz;
begin
  if p_serial is null or length(p_serial) not between 1 and 100
    or p_verified_pin_hash is null or p_verified_pin_hash !~ '^s[12]:[a-f0-9]{32}:[a-f0-9]{64}$'
    or p_expected_credential_version is null or p_expected_credential_version < 0
    or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Applicant authentication unavailable';
  end if;
  -- Serialize first legacy binding; two logins cannot create competing owners.
  select * into v from public.vouchers where serial = p_serial for update;
  if not found then raise exception 'Applicant authentication unavailable'; end if;
  select * into payment from public.payments where id = v.payment_id;
  if not found or payment.paid_at is null or payment.status not in ('successful','refunded')
    or v.user_id is distinct from payment.user_id
    or v.applicant_id is distinct from payment.applicant_id then
    raise exception 'Applicant authentication unavailable';
  end if;
  select * into access_row from public.voucher_access a where a.voucher_id = v.id for update;
  if not found then
    -- Explicit login adoption only. No email matching, owner reassignment or backfill.
    if v.user_id is null or p_expected_credential_version <> 0
      or v.pin_hash is distinct from p_verified_pin_hash then
      raise exception 'Applicant authentication unavailable';
    end if;
    insert into public.applicant_principals default values returning * into principal;
    insert into public.voucher_access(voucher_id, applicant_id, legacy_user_id, credential_state)
      values(v.id, principal.id, v.user_id, 'legacy') returning * into access_row;
    insert into public.audit_logs(actor_applicant_id, action, target_type, target_id)
      values(principal.id, 'voucher_access_bound', 'voucher_access', access_row.id::text);
  end if;
  select * into principal from public.applicant_principals where id = access_row.applicant_id for share;
  if not found or principal.disabled_at is not null or access_row.revoked_at is not null
    or access_row.suspended_at is not null or access_row.credential_state not in ('legacy','current')
    or access_row.credential_version <> p_expected_credential_version then
    raise exception 'Applicant authentication unavailable';
  end if;
  authoritative_hash := case when access_row.credential_state = 'current' then access_row.pin_hash else v.pin_hash end;
  if authoritative_hash is null or authoritative_hash is distinct from p_verified_pin_hash then
    raise exception 'Applicant authentication unavailable';
  end if;
  -- Voucher redemption status/expiry is deliberately NOT a login gate.
  at_time := clock_timestamp();
  insert into public.applicant_sessions(voucher_access_id, token_hash, credential_version,
    created_at, last_seen_at, idle_expires_at, absolute_expires_at)
    values(access_row.id, p_token_hash, access_row.credential_version,
      at_time, at_time, at_time + interval '168 hours', at_time + interval '720 hours')
    returning * into session_row;
  insert into public.audit_logs(actor_applicant_id, action, target_type, target_id)
    values(principal.id, 'applicant_session_opened', 'applicant_sessions', session_row.id::text);
  return query select session_row.id, access_row.id, principal.id, v.id,
    session_row.idle_expires_at, session_row.absolute_expires_at;
end; $$;

create function public.resolve_voucher_session(p_token_hash text)
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
  -- Lock access before session, matching future rotation/revocation operations.
  select * into access_row from public.voucher_access where id = access_id for update;
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
  -- No user-wide joins, profiles, staff notes, credentials or unscoped notifications.
  return query select session_row.id, access_row.id, principal.id, v.id, v.payment_id,
    a.id, session_row.idle_expires_at, session_row.absolute_expires_at
    from public.vouchers v left join public.applications a on a.voucher_id = v.id
    where v.id = access_row.voucher_id;
end; $$;

create function public.logout_voucher_session(p_token_hash text)
returns void language plpgsql security definer set search_path = '' as $$
declare access_id uuid; principal_id uuid; session_id uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then return; end if;
  select s.voucher_access_id into access_id from public.applicant_sessions s where s.token_hash = p_token_hash;
  if not found then return; end if;
  select a.applicant_id into principal_id from public.voucher_access a where a.id = access_id for update;
  if not found then return; end if;
  -- Logout also revokes expired/suspended/stale-version sessions. Retries are no-ops.
  update public.applicant_sessions s set revoked_at = clock_timestamp()
    where s.token_hash = p_token_hash and s.voucher_access_id = access_id and s.revoked_at is null
    returning s.id into session_id;
  if found then
    insert into public.audit_logs(actor_applicant_id, action, target_type, target_id)
      values(principal_id, 'applicant_session_logged_out', 'applicant_sessions', session_id::text);
  end if;
end; $$;

-- Supabase default privileges can grant named roles even after PUBLIC revoke.
revoke all on function public.get_voucher_login_material(text) from public, anon, authenticated, service_role;
revoke all on function public.open_verified_voucher_session(text,text,integer,text) from public, anon, authenticated, service_role;
revoke all on function public.resolve_voucher_session(text) from public, anon, authenticated, service_role;
revoke all on function public.logout_voucher_session(text) from public, anon, authenticated, service_role;
grant execute on function public.get_voucher_login_material(text) to service_role;
grant execute on function public.open_verified_voucher_session(text,text,integer,text) to service_role;
grant execute on function public.resolve_voucher_session(text) to service_role;
grant execute on function public.logout_voucher_session(text) to service_role;
commit;

-- Additive payment/voucher operations. Does not replace the applied foundation.
begin;

-- Preserve purchased validity even when an administrator later edits a type.
alter table public.payments add column validity_days integer check (validity_days between 1 and 1095);
update public.payments p set validity_days = t.validity_days from public.voucher_types t where t.id = p.voucher_type_id;
alter table public.payments alter column validity_days set not null;

create table public.request_limits (
  key text primary key,
  window_start timestamptz not null,
  attempts integer not null check (attempts > 0)
);
alter table public.request_limits enable row level security;
revoke all on public.request_limits from anon, authenticated;

create function public.consume_request_limit(p_key text, p_limit integer, p_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if length(p_key) not between 1 and 200 or p_limit not between 1 and 1000 or p_seconds not between 1 and 86400 then
    raise exception 'Invalid limit parameters';
  end if;
  insert into public.request_limits as r(key, window_start, attempts)
  values(p_key, clock_timestamp(), 1)
  on conflict(key) do update set
    attempts = case when r.window_start + make_interval(secs => p_seconds) <= clock_timestamp() then 1 else least(r.attempts + 1, p_limit + 1) end,
    window_start = case when r.window_start + make_interval(secs => p_seconds) <= clock_timestamp() then clock_timestamp() else r.window_start end
  returning attempts into n;
  return n <= p_limit;
end; $$;

-- Called only after server-side provider verification. The row lock serializes
-- callback/webhook races; the unique payment_id also prevents duplicate issuance.
create function public.fulfill_verified_payment(
  p_reference text, p_amount integer, p_currency text, p_email text,
  p_provider_id text, p_pin_hash text, p_pin_encrypted text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare payment public.payments; voucher_id uuid;
begin
  select * into payment from public.payments where reference = p_reference for update;
  if not found then raise exception 'Payment not found'; end if;
  if payment.provider <> 'paystack' or payment.amount is distinct from p_amount
    or payment.currency is distinct from p_currency
    or lower(payment.customer_email) is distinct from lower(p_email)
    or coalesce(p_provider_id, '') = '' then raise exception 'Payment verification mismatch'; end if;
  if payment.status = 'refunded' then raise exception 'Payment refunded'; end if;
  select id into voucher_id from public.vouchers where payment_id = payment.id;
  if found then
    if payment.status <> 'successful' or payment.provider_id is distinct from p_provider_id then
      raise exception 'Inconsistent payment state';
    end if;
    return voucher_id;
  end if;
  if coalesce(p_pin_hash, '') = '' or coalesce(p_pin_encrypted, '') = '' then raise exception 'Missing voucher credentials'; end if;
  update public.payments set status = 'successful', provider_id = p_provider_id, paid_at = now() where id = payment.id;
  insert into public.vouchers(user_id, payment_id, voucher_type_id, job_id, pin_hash, pin_encrypted, expires_at)
  values(payment.user_id, payment.id, payment.voucher_type_id, payment.job_id, p_pin_hash, p_pin_encrypted,
    now() + make_interval(days => payment.validity_days)) returning id into voucher_id;
  insert into public.notifications(user_id, title, body, href)
  values(payment.user_id, 'Voucher ready', 'Your payment was verified and your voucher is ready.', '/dashboard/vouchers');
  return voucher_id;
end; $$;

-- The server validates the PIN before calling this operation. Comparing the
-- verified hash under lock prevents a concurrent credential/state change.
create function public.redeem_verified_voucher(p_user_id uuid, p_serial text, p_pin_hash text, p_job_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare voucher public.vouchers; selected_job public.jobs; application_id uuid;
begin
  select * into voucher from public.vouchers where serial = p_serial and user_id = p_user_id for update;
  if not found or voucher.pin_hash is distinct from p_pin_hash then raise exception 'Invalid voucher'; end if;
  if voucher.status <> 'unused' or voucher.expires_at <= now() then raise exception 'Voucher unavailable'; end if;
  if voucher.job_id is not null and voucher.job_id <> p_job_id then raise exception 'Voucher is linked to another job'; end if;
  select * into selected_job from public.jobs where id = p_job_id for share;
  if not found or selected_job.status <> 'published' or selected_job.sample
    or selected_job.application_deadline <= now() then raise exception 'Job unavailable'; end if;
  insert into public.applications(user_id, job_id, voucher_id)
  values(p_user_id, p_job_id, voucher.id) returning id into application_id;
  update public.vouchers set status = 'used', activated_at = now(), job_id = p_job_id where id = voucher.id;
  insert into public.application_status_history(application_id, status, message, actor_id)
  values(application_id, 'draft', 'Application started with a verified voucher.', p_user_id);
  insert into public.notifications(user_id, title, body, href)
  values(p_user_id, 'Application started', 'Your application draft is ready to complete.', '/dashboard/applications');
  return application_id;
end; $$;

revoke all on function public.consume_request_limit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.fulfill_verified_payment(text, integer, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.redeem_verified_voucher(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.consume_request_limit(text, integer, integer) to service_role;
grant execute on function public.fulfill_verified_payment(text, integer, text, text, text, text, text) to service_role;
grant execute on function public.redeem_verified_voucher(uuid, text, text, uuid) to service_role;
commit;

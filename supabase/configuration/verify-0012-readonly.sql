-- Read-only confirmation AFTER manual application of 0012, as postgres.
-- Catalog only: no credential values, operation calls or business-row writes.
with expected(signature, service_callable) as (values
  ('public.lock_voucher_recovery(text,boolean)',false),
  ('public.request_voucher_pin_reset(text,text)',true),
  ('public.complete_voucher_pin_reset(text,text,text)',true),
  ('public.revoke_voucher_pin_reset(text)',true),
  ('public.redeem_verified_voucher(uuid,text,text,uuid)',true),
  ('public.redeem_portal_voucher(text,uuid)',true)
), functions as (
  select e.signature,e.service_callable,(p.oid is not null) as exists,
    pg_get_userbyid(p.proowner) as owner,p.prosecdef as security_definer,p.proconfig as config,
    pg_get_functiondef(p.oid) as definition,
    has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
    has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
    has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute,
    exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl where acl.grantee=0 and acl.privilege_type='EXECUTE') as public_execute
  from expected e left join pg_proc p on p.oid=to_regprocedure(e.signature)
), owner_columns as (
  select table_name,column_name,is_nullable,data_type
  from information_schema.columns where table_schema='public'
    and table_name in ('payment_quotes','payments','vouchers','applicants','applications','application_documents','notifications')
    and column_name in ('user_id','applicant_id')
), private_tables as (
  select c.relname as name,c.relrowsecurity as rls_enabled,c.relforcerowsecurity as force_rls,
    has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as any_anon_privilege,
    has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as any_authenticated_privilege,
    has_table_privilege('service_role',c.oid,'SELECT') as service_select,
    has_table_privilege('service_role',c.oid,'INSERT') as service_insert,
    has_table_privilege('service_role',c.oid,'UPDATE') as service_update,
    has_table_privilege('service_role',c.oid,'DELETE') as service_delete,
    (select count(*) from pg_policy where polrelid=c.oid) as policy_count
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
    and c.relname in ('applicant_principals','guest_checkouts','voucher_access','applicant_sessions',
      'voucher_contacts','voucher_contact_challenges','voucher_credential_deliveries','applicant_notification_links')
)
select jsonb_build_object(
  'constraints',(select jsonb_agg(jsonb_build_object('table',c.conrelid::regclass::text,'name',c.conname,'definition',pg_get_constraintdef(c.oid)) order by c.conrelid::regclass::text,c.conname) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public'),
  'indexes',(select jsonb_agg(to_jsonb(i) order by tablename,indexname) from pg_indexes i where schemaname='public'),
  'triggers',(select jsonb_agg(jsonb_build_object('table',t.tgrelid::regclass::text,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid)) order by t.tgrelid::regclass::text,t.tgname) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal),
  'policies',(select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname in ('public','storage')),
  'voucher_pin_columns',(select jsonb_agg(jsonb_build_object('column',column_name,'nullable',is_nullable) order by column_name) from information_schema.columns where table_schema='public' and table_name='vouchers' and column_name in ('pin_hash','pin_encrypted')),
  'functions',(select jsonb_agg(to_jsonb(f) order by signature) from functions f),
  'notification_trigger',(select jsonb_build_object('enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid),'function',p.proname)
    from pg_trigger t join pg_proc p on p.oid=t.tgfoid
    where t.tgrelid='public.notifications'::regclass and t.tgname='voucher_application_notification' and not t.tgisinternal),
  'owner_columns',(select jsonb_agg(to_jsonb(c) order by table_name,column_name) from owner_columns c),
  'private_tables',(select jsonb_agg(to_jsonb(t) order by name) from private_tables t)
) as verification_0012;

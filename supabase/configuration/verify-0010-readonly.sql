-- Read-only catalog confirmation, run as postgres AFTER manual application of 0010.
-- Does not invoke any applicant operation or read credential/session values.
with expected(signature, service_callable) as (values
  ('public.resolve_voucher_session(text)',true),
  ('public.lock_voucher_portal_scope(text,boolean)',false),
  ('public.link_voucher_application_notification()',false),
  ('public.load_voucher_portal(text,integer)',true),
  ('public.redeem_portal_voucher(text,uuid)',true),
  ('public.save_portal_application(text,uuid,integer,jsonb)',true),
  ('public.submit_portal_application(text,uuid,integer,boolean)',true),
  ('public.portal_upload_context(text,uuid,integer,uuid)',true),
  ('public.register_portal_document(text,uuid,integer,uuid,text,text,text,integer)',true),
  ('public.remove_portal_document(text,uuid,integer,uuid)',true),
  ('public.authorize_portal_document(text,uuid,uuid)',true),
  ('public.read_portal_notification(text,uuid)',true)
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
  'functions',(select jsonb_agg(to_jsonb(f) order by signature) from functions f),
  'notification_trigger',(select jsonb_build_object('enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid),'function',p.proname)
    from pg_trigger t join pg_proc p on p.oid=t.tgfoid
    where t.tgrelid='public.notifications'::regclass and t.tgname='voucher_application_notification' and not t.tgisinternal),
  'owner_columns',(select jsonb_agg(to_jsonb(c) order by table_name,column_name) from owner_columns c),
  'private_tables',(select jsonb_agg(to_jsonb(t) order by name) from private_tables t)
) as verification_0010;

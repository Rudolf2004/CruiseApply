-- READ ONLY. Run as postgres in the existing Supabase SQL Editor.
-- Returns function definitions/permissions; no tokens, PINs or applicant rows.
begin transaction read only;
with expected(signature) as (values
 ('public.get_voucher_login_material(text)'),
 ('public.open_verified_voucher_session(text,text,integer,text)'),
 ('public.resolve_voucher_session(text)'),
 ('public.logout_voucher_session(text)')
), functions as (
 select e.signature,p.* from expected e
 left join pg_proc p on p.oid=to_regprocedure(e.signature)
)
select jsonb_build_object(
 'engine',version(),
 'functions',(select jsonb_agg(jsonb_build_object(
   'signature',f.signature,'exists',f.oid is not null,
   'definition',case when f.oid is not null then pg_get_functiondef(f.oid) end,
   'security_definer',f.prosecdef,'configuration',f.proconfig,
   'owner',pg_get_userbyid(f.proowner),
   'anon_execute',has_function_privilege('anon',f.oid,'EXECUTE'),
   'authenticated_execute',has_function_privilege('authenticated',f.oid,'EXECUTE'),
   'service_execute',has_function_privilege('service_role',f.oid,'EXECUTE'),
   'grants',(select coalesce(jsonb_agg(jsonb_build_object(
     'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
     'privilege',a.privilege_type,'grantable',a.is_grantable)),'[]'::jsonb)
     from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a)
 )) from functions f),
 'private_tables',(select jsonb_agg(jsonb_build_object('table',c.relname,'rls',c.relrowsecurity,
   'anon_select',has_table_privilege('anon',c.oid,'SELECT'),
   'authenticated_select',has_table_privilege('authenticated',c.oid,'SELECT')))
   from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname in
    ('applicant_principals','guest_checkouts','voucher_access','applicant_sessions',
     'voucher_contacts','voucher_contact_challenges','voucher_credential_deliveries','applicant_notification_links'))
) as verification_0009;
commit;

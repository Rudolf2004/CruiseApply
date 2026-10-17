-- READ ONLY. Run in Supabase SQL Editor as postgres after applied 0008.
-- This is verification, NOT a migration. Returns one JSON catalog report.
-- Contains no credentials, PINs, tokens, applicant contact data or row bodies.
begin transaction read only;
with
private_names(name) as (values
 ('applicant_principals'),('guest_checkouts'),('voucher_access'),('applicant_sessions'),
 ('voucher_contacts'),('voucher_contact_challenges'),('voucher_credential_deliveries'),('applicant_notification_links')),
scope as (
 select c.oid,c.relname,c.relrowsecurity,c.relacl,c.relowner from pg_class c
 join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r'
),
private_tables as (select s.* from scope s join private_names p on p.name=s.relname),
guards as (
 select p.* from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in
 ('guard_guest_checkout_binding','guard_applicant_owner_identity','guard_voucher_access_binding',
 'guard_applicant_session_bounds','guard_voucher_contact_binding','guard_voucher_challenge_binding',
 'guard_credential_delivery_binding','guard_applicant_notification_binding')
)
select jsonb_build_object(
 'engine',version(),
 'private_tables',(select jsonb_agg(jsonb_build_object(
   'name',t.relname,'rls',t.relrowsecurity,
   'privileges',(select jsonb_agg(jsonb_build_object('role',r.name,'privilege',v.name,
     'allowed',has_table_privilege(r.name,t.oid,v.name)))
     from (values ('anon'),('authenticated'),('service_role')) r(name)
     cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) v(name)),
   'public_acl',(select coalesce(jsonb_agg(a.privilege_type),'[]'::jsonb)
     from aclexplode(coalesce(t.relacl,acldefault('r',t.relowner))) a where a.grantee=0)
 )) from private_tables t),
 'columns',(select jsonb_agg(jsonb_build_object('table',s.relname,'column',a.attname,
    'not_null',a.attnotnull,'type',format_type(a.atttypid,a.atttypmod),
    'default',pg_get_expr(d.adbin,d.adrelid)))
   from scope s join pg_attribute a on a.attrelid=s.oid and a.attnum>0 and not a.attisdropped
   left join pg_attrdef d on d.adrelid=s.oid and d.adnum=a.attnum
   where s.relname in (select name from private_names)
      or a.attname in ('user_id','applicant_id','guest_checkout_id','actor_applicant_id')),
 'constraints',(select jsonb_agg(jsonb_build_object('table',s.relname,'name',c.conname,
   'type',c.contype,'validated',c.convalidated,'definition',pg_get_constraintdef(c.oid)))
   from scope s join pg_constraint c on c.conrelid=s.oid),
 'indexes',(select jsonb_agg(jsonb_build_object('table',s.relname,'definition',pg_get_indexdef(i.indexrelid),
   'valid',i.indisvalid,'ready',i.indisready)) from scope s join pg_index i on i.indrelid=s.oid),
 'policies',(select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from pg_policies p where p.schemaname='public'),
 'triggers',(select jsonb_agg(jsonb_build_object('table',s.relname,'enabled',t.tgenabled,
   'definition',pg_get_triggerdef(t.oid))) from scope s join pg_trigger t on t.tgrelid=s.oid where not t.tgisinternal),
 'guards',(select jsonb_agg(jsonb_build_object('name',g.proname,'definition',pg_get_functiondef(g.oid),
   'anon_execute',has_function_privilege('anon',g.oid,'EXECUTE'),
   'authenticated_execute',has_function_privilege('authenticated',g.oid,'EXECUTE'),
   'service_execute',has_function_privilege('service_role',g.oid,'EXECUTE'))) from guards g),
 'existing_functions',(select jsonb_agg(jsonb_build_object('name',p.proname,
    'definition',pg_get_functiondef(p.oid),'security_definer',p.prosecdef,
    'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),
    'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
    'service_execute',has_function_privilege('service_role',p.oid,'EXECUTE')))
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.prokind='f'
     and p.proname not in (select proname from guards)),
 'new_table_counts',jsonb_build_object(
   'applicant_principals',(select count(*) from public.applicant_principals),
   'guest_checkouts',(select count(*) from public.guest_checkouts),
   'voucher_access',(select count(*) from public.voucher_access),
   'applicant_sessions',(select count(*) from public.applicant_sessions),
   'voucher_contacts',(select count(*) from public.voucher_contacts),
   'voucher_contact_challenges',(select count(*) from public.voucher_contact_challenges),
   'voucher_credential_deliveries',(select count(*) from public.voucher_credential_deliveries),
   'applicant_notification_links',(select count(*) from public.applicant_notification_links))
) as verification_0008;
commit;

import { readFile, writeFile } from 'node:fs/promises';
const sql=await readFile('supabase/migrations/202610030011_guest_checkout_claim.sql','utf8');
const hidden=new Set(['guard_principal_business_chain','lock_guest_checkout','lock_voucher_portal_scope','save_application_draft_principal','register_application_document_principal','remove_application_document_principal','submit_application_principal']);
const functions=[...sql.matchAll(/create (?:or replace )?function public\.(\w+)\(([^)]*)\)/g)].map(([,name,args])=>({name,signature:'public.'+name+'('+args.split(',').filter(s=>s.trim()).map(s=>s.trim().split(/\s+/)[1]).join(',')+')',callable:!hidden.has(name)}));
let query=await readFile('supabase/configuration/verify-0010-readonly.sql','utf8');
query=query.replace(/-- Read-only[\s\S]*?with expected/, '-- Read-only confirmation AFTER manual application of 0011, as postgres.\n-- Catalog only: no credential values, operation calls or business-row writes.\nwith expected');
query=query.replace(/as \(values[\s\S]*?\n\), functions/, 'as (values\n'+functions.map(f=>`  ('${f.signature}',${f.callable})`).join(',\n')+'\n), functions');
query=query.replace("'functions',(select",`'constraints',(select jsonb_agg(jsonb_build_object('table',c.conrelid::regclass::text,'name',c.conname,'definition',pg_get_constraintdef(c.oid)) order by c.conrelid::regclass::text,c.conname) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public'),
  'indexes',(select jsonb_agg(to_jsonb(i) order by tablename,indexname) from pg_indexes i where schemaname='public'),
  'triggers',(select jsonb_agg(jsonb_build_object('table',t.tgrelid::regclass::text,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid)) order by t.tgrelid::regclass::text,t.tgname) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal),
  'policies',(select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname in ('public','storage')),
  'voucher_pin_columns',(select jsonb_agg(jsonb_build_object('column',column_name,'nullable',is_nullable) order by column_name) from information_schema.columns where table_schema='public' and table_name='vouchers' and column_name in ('pin_hash','pin_encrypted')),
  'functions',(select`);
query=query.replace('as verification_0010','as verification_0011');
await writeFile('supabase/configuration/verify-0011-readonly.sql',query);
console.log('Prepared catalog query for '+functions.length+' functions.');

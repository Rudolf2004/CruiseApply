import {readFile,writeFile} from 'node:fs/promises';
const path='supabase/migrations/202610040013_applicant_responses_withdrawal.sql';
const sql=(await readFile(path,'utf8')).replace(/^\uFEFF/,'');await writeFile(path,sql);
const functions=[...sql.matchAll(/create function public\.(\w+)\(([^)]*)\)/g)].map(([,name,args])=>({signature:'public.'+name+'('+args.split(',').filter(s=>s.trim()).map(s=>s.trim().split(/\s+/)[1]).join(',')+')',callable:name!=='guard_applicant_command'}));
let query=await readFile('supabase/configuration/verify-0012-readonly.sql','utf8');
query=query.replace('of 0012','of 0013').replace(/as \(values[\s\S]*?\n\), functions/,()=> 'as (values\n'+functions.map(f=>`  ('${f.signature}',${f.callable})`).join(',\n')+'\n), functions').replace('as verification_0012','as verification_0013').replace("'voucher_contacts','voucher_contact_challenges','voucher_credential_deliveries','applicant_notification_links')","'voucher_contacts','voucher_contact_challenges','voucher_credential_deliveries','applicant_notification_links','application_applicant_commands')");
await writeFile('supabase/configuration/verify-0013-readonly.sql',query);

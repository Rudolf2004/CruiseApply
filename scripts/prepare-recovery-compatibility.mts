import {readFile,writeFile} from 'node:fs/promises';
const fn=(s,n)=>{const start=s.search(new RegExp('create (?:or replace )?function public\\.'+n+'\\('));if(start<0)throw Error(n);return s.slice(start,s.indexOf('$$;',start)+3).replace('create function','create or replace function');};
let legacy=fn(await readFile('supabase/migrations/202609290002_payment_vouchers.sql','utf8'),'redeem_verified_voucher');
legacy=legacy.replace('declare voucher public.vouchers;', 'declare access_row public.voucher_access; authoritative_hash text; voucher public.vouchers;');
legacy=legacy.replace("if not found or voucher.pin_hash is distinct from p_pin_hash then raise exception 'Invalid voucher'; end if;",`if not found then raise exception 'Invalid voucher'; end if;
  select * into access_row from public.voucher_access where voucher_id=voucher.id for update;
  if found and (access_row.revoked_at is not null or access_row.suspended_at is not null
    or exists(select 1 from public.applicant_principals where id=access_row.applicant_id and disabled_at is not null)) then raise exception 'Invalid voucher'; end if;
  authoritative_hash:=case when access_row.credential_state='current' then access_row.pin_hash else voucher.pin_hash end;
  if authoritative_hash is distinct from p_pin_hash then raise exception 'Invalid voucher'; end if;`);
let portal=fn(await readFile('supabase/migrations/202610030011_guest_checkout_claim.sql','utf8'),'redeem_portal_voucher');
portal=portal.replace('s.legacy_user_id,v.serial,v.pin_hash,p_job_id',"s.legacy_user_id,v.serial,(select case when a.credential_state='current' then a.pin_hash else v.pin_hash end from public.voucher_access a where a.id=s.voucher_access_id),p_job_id");
// Scope helper names the access column access_id, not a browser-provided value.
portal=portal.replace('a.id=s.voucher_access_id','a.voucher_id=v.id');
const path='supabase/migrations/202610030012_voucher_pin_recovery.sql';let sql=await readFile(path,'utf8');sql=sql.slice(0,sql.indexOf('-- Legacy redemption proof'))+'-- Legacy redemption proof stays consistent with rotated access.\n'+legacy+'\n\n'+portal+'\n\ncommit;\n';await writeFile(path,sql);

import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
const path='test-results/applicant-browser-fixture.json',s=JSON.parse(await readFile(path,'utf8'));
assert.equal(s.kind,'UI PREVIEW ONLY - synthetic, no provider transaction');
const owner=JSON.parse(await readFile('test-results/applicant-ui-preview.json','utf8'));assert.notEqual(s.principal,owner.principal);assert.notEqual(s.voucher,owner.voucher);
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
async function remove(table:string,column:string,value:string){assert.ok(value);for(let attempt=0;attempt<3;attempt++){const r=await db.from(table).delete().eq(column,value);if(!r.error)return;if(attempt===2)throw new Error('Cleanup blocked: '+table+' '+r.error.code);}}
const payment=await db.from('payments').select('provider,applicant_id').eq('id',s.payment).maybeSingle();if(payment.error)throw new Error('Cannot verify fixture owner');if(payment.data){assert.equal(payment.data.provider,'ui_preview_fixture');assert.equal(payment.data.applicant_id,s.principal);}
for(const t of ['applicant_notification_links','voucher_credential_deliveries','voucher_contact_challenges','voucher_contacts','applicant_sessions'])await remove(t,'voucher_access_id',s.access);
await remove('voucher_access','id',s.access);await remove('vouchers','id',s.voucher);await remove('payments','id',s.payment);await remove('guest_checkouts','id',s.checkout);
await remove('audit_logs','actor_applicant_id',s.principal);
for(const id of [s.access,s.voucher,s.payment,s.checkout,s.principal])await remove('audit_logs','target_id',id);
await remove('applicant_principals','id',s.principal);
s.cleaned=true;delete s.capability;await writeFile(path,JSON.stringify(s,null,2));console.log('Disposable browser fixture removed; owner UI fixture untouched.');

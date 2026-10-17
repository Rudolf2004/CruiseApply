import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash,createCipheriv,createDecipheriv} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {chromium} from 'playwright-core';
const path=process.argv.includes('--automated-fixture')?'test-results/applicant-browser-fixture.json':'test-results/applicant-ui-preview.json';
const origin='https://localhost:3443';
assert.ok(process.env.PAYSTACK_SECRET_KEY?.startsWith('sk_test_'),'Test configuration required');
const key=Buffer.from(process.env.VOUCHER_ENCRYPTION_KEY??'','hex');assert.equal(key.length,32);
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
function ok<T extends {error:unknown}>(r:T):T{if(r.error)throw new Error('Preview fixture operation failed; inspect ledger without exposing secrets');return r;}
function seal(raw:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);const encrypted=Buffer.concat([cipher.update(raw,'utf8'),cipher.final()]);return {iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),data:encrypted.toString('hex')};}
function unseal(c:{iv:string;tag:string;data:string}){const cipher=createDecipheriv('aes-256-gcm',key,Buffer.from(c.iv,'hex'));cipher.setAuthTag(Buffer.from(c.tag,'hex'));return Buffer.concat([cipher.update(Buffer.from(c.data,'hex')),cipher.final()]).toString('utf8');}
type PreviewState={kind:string;capability:{iv:string;tag:string;data:string};payment:string;voucher:string;access:string;serial:string;createdAt:string;ready:boolean;cleaned?:boolean;checkout?:string;principal?:string};
let state:PreviewState | undefined;
try{state=JSON.parse(await readFile(path,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
if(process.argv.includes('--automated-fixture')&&state?.cleaned)state=undefined;
const raw=state?unseal(state.capability):randomBytes(32).toString('base64url');
const digest=createHash('sha256').update(raw).digest('hex');
async function checkpoint(){await writeFile(path,JSON.stringify(state,null,2));}
if(!state){state={kind:'UI PREVIEW ONLY - synthetic, no provider transaction',capability:seal(raw),payment:randomUUID(),voucher:randomUUID(),access:randomUUID(),serial:'UI-TEST-'+randomBytes(6).toString('hex').toUpperCase(),createdAt:new Date().toISOString(),ready:false};await checkpoint();}
if(!state.ready){
 // Reruns use the same IDs and never create a second synthetic payment.
 if(!state.checkout){const existing=ok(await db.from('guest_checkouts').select('id').eq('capability_hash',digest).maybeSingle()).data;state.checkout=existing?.id;
if(!state.checkout)state.checkout=ok(await db.rpc('begin_guest_checkout',{p_capability_hash:digest,p_email:'ui-preview@example.invalid',p_name:'UI PREVIEW ONLY - temporary applicant',p_country_code:'GH'})).data;await checkpoint();}
 state.principal=ok(await db.from('guest_checkouts').select('applicant_id').eq('id',state.checkout).single()).data!.applicant_id;await checkpoint();
 const product=ok(await db.from('voucher_types').select('id').eq('code','application-access').single()).data!;
 if(!ok(await db.from('payments').select('id').eq('id',state.payment).maybeSingle()).data){
  ok(await db.from('payments').insert({id:state.payment,applicant_id:state.principal,guest_checkout_id:state.checkout,provider:'ui_preview_fixture',reference:state.serial,voucher_type_id:product.id,product_name:'UI PREVIEW ONLY - no purchase or payment',amount:1,currency:'GHS',validity_days:7,customer_email:'ui-preview@example.invalid',status:'successful',provider_id:'SYNTHETIC-NO-PROVIDER',paid_at:new Date().toISOString()}));
 }
 if(!ok(await db.from('vouchers').select('id').eq('id',state.voucher).maybeSingle()).data)ok(await db.from('vouchers').insert({id:state.voucher,applicant_id:state.principal,payment_id:state.payment,voucher_type_id:product.id,serial:state.serial,expires_at:new Date(Date.now()+7*86400000).toISOString()}));
 if(!ok(await db.from('voucher_access').select('id').eq('id',state.access).maybeSingle()).data)ok(await db.from('voucher_access').insert({id:state.access,applicant_id:state.principal,voucher_id:state.voucher,credential_state:'pending_delivery'}));
 if(!ok(await db.from('voucher_contacts').select('id').eq('voucher_access_id',state.access).maybeSingle()).data)ok(await db.from('voucher_contacts').insert({voucher_access_id:state.access,email:'ui-preview@example.invalid'}));
 if(!ok(await db.from('voucher_credential_deliveries').select('id').eq('voucher_access_id',state.access).maybeSingle()).data)ok(await db.from('voucher_credential_deliveries').insert({voucher_access_id:state.access,guest_checkout_id:state.checkout,capability_hash:digest,expires_at:new Date(Date.now()+86400000).toISOString()}));
 state.ready=true;await checkpoint();
}
if(process.argv.includes('--prepare-only')){console.log('Temporary fixture prepared; no PIN generated, no Paystack request.');process.exit(0);}
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:false});
const context=await browser.newContext();
await context.addCookies([{name:'__Host-cruiseapply_checkout',value:raw,url:origin,secure:true,httpOnly:true,sameSite:'Lax'}]);
const page=await context.newPage();
await page.goto(origin+'/buy-voucher/result',{timeout:300000});
await page.getByRole('button',{name:'Receive Serial Number and PIN',exact:true}).waitFor({timeout:300000});
console.log('Temporary applicant claim screen opened. PIN is generated only when you click Receive Serial Number and PIN. No PIN has been stored or logged.');
await new Promise<void>(resolve=>browser.on('disconnected',()=>resolve()));






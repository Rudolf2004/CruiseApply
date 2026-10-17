import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createDecipheriv} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {chromium} from 'playwright-core';
const file='test-results/applicant-browser-fixture.json';
const state=JSON.parse(await readFile(file,'utf8'));assert.equal(state.kind,'UI PREVIEW ONLY - synthetic, no provider transaction');assert.ok(state.ready&&!state.cleaned);
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
function ok<T extends {error:unknown}>(r:T):T{if(r.error)throw new Error('Fixture database operation failed');return r;}
const payment=ok(await db.from('payments').select('provider,applicant_id').eq('id',state.payment).single()).data!;
assert.equal(payment.provider,'ui_preview_fixture');assert.equal(payment.applicant_id,state.principal);
const cipher=createDecipheriv('aes-256-gcm',Buffer.from(process.env.VOUCHER_ENCRYPTION_KEY!,'hex'),Buffer.from(state.capability.iv,'hex'));cipher.setAuthTag(Buffer.from(state.capability.tag,'hex'));
const raw=Buffer.concat([cipher.update(Buffer.from(state.capability.data,'hex')),cipher.final()]).toString('utf8');
const origin='https://localhost:3443',checks:string[]=[];
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
let phase='claim',passed=false;
try{
 const context=await browser.newContext();
 await context.addCookies([{name:'__Host-cruiseapply_checkout',value:raw,url:origin,secure:true,httpOnly:true,sameSite:'Lax'}]);
 const page=await context.newPage();page.setDefaultTimeout(180000);
 let statusCode=0;
 for(let attempt=0;attempt<3;attempt++){
  const loaded=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/guest-checkout/status');
  await page.goto(origin+'/buy-voucher/result',{timeout:300000});
  statusCode=(await loaded).status();if(statusCode!==503)break;
 }
 assert.equal(statusCode,200,'Guest status unavailable after bounded read retries');
 let claimed=false;
 for(let attempt=0;attempt<3;attempt++){
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/guest-checkout/claim');
  await page.getByRole('button',{name:'Receive Serial Number and PIN',exact:true}).click();
  const code=(await response).status();if(code===200){claimed=true;break;}
  assert.equal(code,503,'Claim rejected');
  const status=await context.request.get(origin+'/api/guest-checkout/status');
  assert.equal(status.status(),200,'Cannot safely retry claim without status');
  assert.equal((await status.json()).payment.claim_available,true,'Claim may have committed; never regenerate credentials');
 }
 assert.ok(claimed,'Claim service unavailable after bounded retries');
 await page.getByRole('heading',{name:'Save your applicant credentials now'}).waitFor();
 const credentials=await page.locator('dd').allTextContents();const serial=credentials[0],pin=credentials[1];
 assert.equal(serial,state.serial);assert.match(pin,/^\d{8}$/);
 const cookie=(await context.cookies()).find(c=>c.name==='__Host-cruiseapply_applicant');assert.ok(cookie?.secure&&cookie.httpOnly&&cookie.sameSite==='Lax');checks.push('Normal one-time claim and secure session cookie');
 await page.getByRole('link',{name:'I have saved my credentials — continue'}).click();
 await page.waitForURL(origin+'/applicant');
 phase='pages';
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});
  for(const route of ['', '/application','/documents','/notifications','/payment']){
   await page.goto(origin+'/applicant'+route,{timeout:300000});await page.locator('.applicant-content').waitFor();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Horizontal overflow');
   assert.equal(await page.getByRole('heading',{level:1}).count(),1);
   await page.screenshot({path:'test-results/applicant-verified-'+(route.slice(1)||'overview')+'-'+width+'.png',fullPage:true});
  }
 }
 checks.push('All five real portal sections at desktop/mobile; one main heading; no page overflow');
 phase='mobile navigation';await page.locator('#applicant-navigation[inert]').waitFor();
 await page.getByRole('button',{name:'Toggle applicant navigation'}).click();
 await page.keyboard.press('Escape');await page.locator('#applicant-navigation[inert]').waitFor();checks.push('Closed mobile navigation inert; Escape closes it');
 phase='logout';await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.waitForURL(origin+'/applicant/login');
 const denied=await context.request.post(origin+'/api/applicant-auth/session',{headers:{origin}});assert.equal(denied.status(),401);
 phase='login';await page.getByLabel('Voucher serial number',{exact:true}).fill(serial);await page.getByLabel('PIN',{exact:true}).fill(pin);await page.getByRole('button',{name:'Applicant Login',exact:true}).click();await page.waitForURL(origin+'/applicant');
 checks.push('Logout revokes access; original Serial/PIN logs back in normally');
 const duplicate=await context.request.post(origin+'/api/guest-checkout/claim',{headers:{origin},data:{}});assert.equal(duplicate.status(),409);checks.push('Duplicate credential claim rejected');
 passed=true;
}catch{console.error('Applicant browser verification failed at '+phase);process.exitCode=1;}
finally{
 await browser.close();
 try{
  for(const table of ['applicant_notification_links','voucher_credential_deliveries','voucher_contact_challenges','voucher_contacts','applicant_sessions'])ok(await db.from(table).delete().eq('voucher_access_id',state.access));
  ok(await db.from('voucher_access').delete().eq('id',state.access));
  ok(await db.from('vouchers').delete().eq('id',state.voucher));
  ok(await db.from('payments').delete().eq('id',state.payment));
  ok(await db.from('guest_checkouts').delete().eq('id',state.checkout));
  ok(await db.from('audit_logs').delete().eq('actor_applicant_id',state.principal));
  for(const target of [state.access,state.voucher,state.payment,state.checkout,state.principal])ok(await db.from('audit_logs').delete().eq('target_id',target));
  ok(await db.from('applicant_principals').delete().eq('id',state.principal));
  state.cleaned=true;delete state.capability;await writeFile(file,JSON.stringify(state,null,2));
 }catch{process.exitCode=1;console.error('Fixture cleanup incomplete; retain ledger');}
 await writeFile('test-results/applicant-enabled-browser.json',JSON.stringify({passed:passed&&!process.exitCode,phase,checks,cleaned:state.cleaned??false,paystackTransactions:0},null,2));
 if(!process.exitCode)console.log('PASS: applicant portal browser checks; disposable fixture removed');
}



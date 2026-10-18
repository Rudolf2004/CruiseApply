import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
const base='https://localhost:3490',checks:string[]=[];
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const old={reference:'CA-browser-old',status:'pending',charge_amount:15000,charge_currency:'GHS',claim_available:false};
const quote={id:'167f2ca0-63ed-4ee4-a713-f9d62656b79f',product_name:'Application Access',country_code:'GH',region_code:null,validity_days:90,charge_amount:15000,charge_currency:'GHS',display_amount:15000,display_currency:'GHS',display_minor_units:2,exchange_rate:null,exchange_rate_source:null,exchange_rate_as_of:null,expires_at:new Date(Date.now()+900000).toISOString()};
try{
 for(const scenario of ['fresh','quote-only','claimed','unclaimed','pending','pending-resume'] as const){
  console.log('Checking browser scenario: '+scenario);const context=await browser.newContext({viewport:{width:scenario==='fresh'?390:1440,height:1100}}),page=await context.newPage();page.setDefaultTimeout(180000);const calls:{path:string;data:Record<string,unknown>}[]=[];
  await context.route('https://checkout.paystack.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<h1>Intercepted existing checkout</h1>'}));
  await context.route('**/api/guest-checkout/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('/status')){await route.fulfill({status:scenario==='fresh'?401:200,json:{checkout_id:'fixture-checkout',payment:scenario==='fresh'||scenario==='quote-only'?null:{...old,status:scenario==='claimed'||scenario==='unclaimed'?'successful':'pending',claim_available:scenario==='unclaimed'}}});return;}
   const data=route.request().postDataJSON();calls.push({path,data});
   if(path.endsWith('/quote')){await route.fulfill({status:200,json:{quote}});return;}
   if(path.endsWith('/resume')){await route.fulfill({status:200,json:{authorizationUrl:'https://checkout.paystack.com/browser-existing'}});return;}
   throw new Error('Unexpected provider initialization: '+path);
  });
  await page.goto(base+'/buy-voucher',{timeout:240000});await page.getByRole('heading',{name:'Purchase a voucher',exact:true}).waitFor();
  await page.getByLabel('Full name',{exact:true}).fill('Browser verification');await page.getByLabel('Email address',{exact:true}).fill('browser@example.invalid');await page.getByRole('combobox').selectOption('GH');
  await page.getByText('Checking for an existing checkout?',{exact:true}).waitFor({state:'hidden'});
  if(scenario==='fresh'||scenario==='quote-only'){
   assert.equal(await page.getByRole('checkbox').count(),0);assert.equal(await page.getByRole('link',{name:'View payment status',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Continue existing payment',exact:true}).count(),0);
  }
  if(scenario==='pending-resume'){
   await page.getByRole('button',{name:'Continue existing payment',exact:true}).click();await page.waitForURL('https://checkout.paystack.com/browser-existing');assert.equal(calls.length,1);assert.ok(calls[0].path.endsWith('/resume'));checks.push('Resume reuses saved link without quote or initialization');await context.close();continue;
  }
  if(scenario==='unclaimed'){
   assert.ok(await page.getByRole('button',{name:'Review price',exact:true}).isDisabled());assert.equal(await page.getByRole('checkbox').count(),0);assert.equal(calls.length,0);checks.push('Paid/unclaimed credentials remain protected');await context.close();continue;
  }
  if(scenario==='pending'){
   assert.ok(await page.getByRole('button',{name:'Review price',exact:true}).isDisabled());await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Review separate purchase',exact:true}).click();assert.equal(calls[0].data.startNewForReference,old.reference);
  }else await page.getByRole('button',{name:'Review price',exact:true}).click();
  await page.getByRole('heading',{name:'Review your price',exact:true}).waitFor();assert.ok(await page.getByRole('button',{name:'Pay GHS 150.00 with Paystack',exact:true}).isVisible());assert.equal(calls.length,1);assert.ok(calls[0].path.endsWith('/quote'));if(scenario!=='pending')assert.equal(calls[0].data.startNewForReference,undefined);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));checks.push(scenario+': price review only, no payment initialization');
  if(scenario==='fresh')await page.screenshot({path:'test-results/purchase-clean-mobile.png',fullPage:true});await context.close();
 }
 await writeFile('test-results/purchase-clean-browser.json',JSON.stringify({passed:true,checks,paymentApisMocked:true,paystackCalls:0,databaseWrites:0},null,2));console.log('PASS: '+checks.length+' clean/existing checkout browser scenarios');
}finally{await browser.close();}

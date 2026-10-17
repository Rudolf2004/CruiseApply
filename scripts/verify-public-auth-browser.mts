import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const base='http://localhost:3000',checks=[];
try{const context=await browser.newContext(),page=await context.newPage();page.setDefaultTimeout(60000);
for(const width of [390,1024,1440]){await page.setViewportSize({width,height:900});
await page.goto(base+'/register');await page.waitForURL('**/buy-voucher');await page.getByRole('heading',{name:'Voucher purchases are not open yet'}).waitFor();assert.equal(await page.locator('input[type=password]').count(),0);
await page.goto(base+'/applicant/login');await page.getByRole('heading',{name:'Applicant Login',exact:true}).waitFor();assert.equal(await page.locator('input').count(),0);await page.getByRole('status').filter({hasText:'temporarily unavailable'}).waitFor();
await page.goto(base+'/login');await page.getByRole('heading',{name:'Staff Login',exact:true}).waitFor();await page.getByLabel('Email address',{exact:true}).waitFor();assert.equal(await page.locator('a[href="/register"]').count(),0);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
if(width===390){await page.getByRole('button',{name:'Toggle navigation'}).click();await page.locator('#mobile-nav').getByRole('link',{name:'Applicant Login',exact:true}).waitFor();await page.locator('#mobile-nav').getByRole('link',{name:'Buy Voucher',exact:true}).waitFor();}
await page.screenshot({path:'test-results/staff-login-'+width+'.png',fullPage:true});checks.push('Public registration removal, disabled availability and staff login at '+width+'px');}
const response=await context.request.post(base+'/api/auth/register',{headers:{origin:base},data:{email:'no-user-created@example.com',password:'unused',full_name:'Test'}});assert.equal(response.status(),410);checks.push('Registration API rejected');
await context.close();await writeFile('test-results/public-auth-browser.json',JSON.stringify({passed:true,checks},null,2));console.log('PASS: public applicant/staff journey browser checks');}finally{await browser.close();}


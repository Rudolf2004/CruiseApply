import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
try{
 const page=await browser.newPage();
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});
  await page.goto('https://localhost:3443/applicant/login',{timeout:300000});
  await page.getByRole('heading',{name:'Welcome back'}).waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
  await page.screenshot({path:'test-results/applicant-login-design-'+width+'.png',fullPage:true});
 }
 console.log('PASS: secure applicant login desktop/mobile rendering; no page overflow');
}finally{await browser.close();}

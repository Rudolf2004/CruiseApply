import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
try{
 const page=await browser.newPage();
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});
  await page.goto('http://localhost:3000',{timeout:90000});
  await page.getByRole('heading',{name:'How CruiseApply Works',exact:true}).waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
  await page.getByText('Does buying a voucher guarantee a job?',{exact:true}).click();
  await page.screenshot({path:'test-results/marketing-'+width+'.png',fullPage:true});
 }
 console.log('PASS: public homepage desktop/mobile, FAQ and no horizontal overflow');
}finally{await browser.close();}

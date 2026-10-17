import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';

// Starts a separate local production server with the existing DISABLED config.
// Never changes the flag or sends credentials, payment requests or hosted RPCs.
assert.notEqual(process.env.APPLICANT_AUTH_ENABLED,'true','Rollout must remain disabled');
const probe=createServer();
probe.listen(0,'127.0.0.1');await once(probe,'listening');
const address=probe.address();assert.ok(address&&typeof address==='object');
const port=address.port;await new Promise<void>(resolve=>probe.close(()=>resolve()));
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:process.env});
let exited=false;child.once('exit',()=>{exited=true;});
let output='';
child.stdout.on('data',chunk=>{output=(output+String(chunk)).slice(-4000);});
child.stderr.on('data',()=>{}); // no application/environment/error dump
const checks: {path:string;status:number;cookie:boolean}[]=[];
try {
  const deadline=Date.now()+120000;
  while(!output.includes('Ready in')) {
    assert.ok(!exited,'Production test server exited before readiness');
    assert.ok(Date.now()<deadline,'Production test server readiness timed out');
    await delay(250);
  }
  for(const path of ['login','session','logout']) {
    const result=await fetch(`http://127.0.0.1:${port}/api/applicant-auth/${path}`,{method:'POST',headers:{origin:'https://untrusted.invalid','content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(120000)});
    assert.equal(result.status,404);assert.equal(result.headers.get('set-cookie'),null);
    assert.ok(result.headers.get('cache-control')?.includes('no-store'));
    assert.deepEqual(await result.json(),{error:'Not found.'});
    checks.push({path,status:result.status,cookie:false});
    const get=await fetch(`http://127.0.0.1:${port}/api/applicant-auth/${path}`,{signal:AbortSignal.timeout(120000)});
    assert.equal(get.status,405);assert.equal(get.headers.get('set-cookie'),null);
  }
  for(const [path,method] of [['/api/applicant-portal/matches','GET'],['/api/applicant-portal/matches/consent','POST'],['/api/applicant-portal/applications/10000000-0000-4000-8000-000000000001/responses','POST'],['/api/applicant-portal/applications/10000000-0000-4000-8000-000000000001/responses','GET'],['/api/applicant-portal/applications/10000000-0000-4000-8000-000000000001/responses/documents','POST'],['/api/applicant-portal/applications/10000000-0000-4000-8000-000000000001/withdraw','POST'],['/api/applicant-auth/recovery/request','POST'],['/api/applicant-auth/recovery/complete','POST'],['/applicant/recovery','GET'],['/api/applicant-portal','GET'],['/api/guest-checkout/status','GET'],['/api/guest-checkout/quote','POST'],['/api/guest-checkout/initialize','POST'],['/api/guest-checkout/claim','POST'],['/api/guest-checkout/verify','POST'],['/api/guest-checkout/callback','GET'],['/applicant','GET'],['/applicant/login','GET'],['/buy-voucher/result','GET']]) {
    const response=await fetch(`http://127.0.0.1:${port}${path}`,{method,redirect:'manual',signal:AbortSignal.timeout(120000),...(method==='POST'?{headers:{'content-type':'application/json'},body:'{}'}:{})});
    if(path.startsWith('/api/'))assert.equal(response.status,404,path);
    else {assert.ok([200,404].includes(response.status));const html=await response.text();assert.ok(html.includes(path==='/applicant/login'?'Applicant portal access is temporarily unavailable':'This page has sailed away'),path);assert.ok(!html.includes('name="pin"'),path);}
    assert.equal(response.headers.get('set-cookie'),null,path);
    checks.push({path,status:response.status,cookie:false});
  }
  for(const path of ['/api/admin/records/payments/export','/api/admin/records/audit/export']){const response=await fetch(`http://127.0.0.1:${port}${path}`,{signal:AbortSignal.timeout(120000)});assert.equal(response.status,401);assert.equal(response.headers.get('set-cookie'),null);checks.push({path,status:response.status,cookie:false});}
  const mutation=await fetch(`http://127.0.0.1:${port}/api/admin/configuration`,{method:'POST',headers:{origin:'https://untrusted.invalid','content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(120000)});assert.equal(mutation.status,403);
  const pricingMutation=await fetch(`http://127.0.0.1:${port}/api/admin/pricing`,{method:'POST',headers:{origin:'https://untrusted.invalid','content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(120000)});assert.equal(pricingMutation.status,403);
  const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  try {
    for(const width of [390,1440]) {
      const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
      for(const route of ['/applicant/login','/applicant/recovery']) {
      const response=await page.goto(`http://127.0.0.1:${port}${route}`);
      assert.ok([200,404].includes(response?.status()??0));
      await page.getByRole('heading',{name:route==='/applicant/login'?'Applicant Login':'This page has sailed away'}).waitFor();
      assert.equal(await page.locator('input[name="pin"]').count(),0);}

      assert.equal((await context.cookies()).some(c=>c.name.startsWith('__Host-cruiseapply')),false);
      const status=await page.evaluate(async()=>{const r=await fetch('/api/guest-checkout/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});return r.status;});
      assert.equal(status,404);await context.close();
    }
  } finally {await browser.close();}
  await writeFile('test-results/applicant-auth-disabled-http.json',JSON.stringify({checks,rolloutEnabled:false,methodGuards:true,browserWidths:[390,1440],hostedWrites:0},null,2));
  console.log('PASS: applicant/guest routes remain disabled without credentials or cookies; desktop/mobile browser denial checks passed.');
} finally {
  if(!exited) {
    const closed=once(child,'exit');child.kill();
    await Promise.race([closed,delay(10000).then(()=>{throw new Error('Test server shutdown timed out');})]);
  }
}


import {writeFile} from 'node:fs/promises';
const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':'cruiseapply-local-email-setup-20261012'},body:JSON.stringify({from:process.env.EMAIL_FROM,to:['rudolfkobbysetor@gmail.com'],subject:'CruiseApply — email configuration test',text:'CruiseApply email sending is being tested locally. This message confirms the email configuration test reached your mailbox. No voucher PIN was reset and no payment was made. Please confirm receipt in the development conversation.'}),signal:AbortSignal.timeout(20000)});
const result={checkedAt:new Date().toISOString(),provider:'resend',accepted:response.ok,httpStatus:response.status,inboxReceiptConfirmed:false,pinReset:false,paystackCalls:0};
await writeFile('test-results/resend-configuration-test.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
if(!response.ok)process.exitCode=1;

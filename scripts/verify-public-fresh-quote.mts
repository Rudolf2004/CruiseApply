import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}}),email='checkout-qa-'+randomUUID()+'@example.invalid',name='CruiseApply fresh-checkout verification';
let status:number|undefined,amount:number|undefined,cleaned=false;
try{
 const product=await db.from('voucher_types').select('id').eq('code','application-access').single();assert.ok(!product.error);
 const response=await fetch('https://cruiseapply.online/api/guest-checkout/quote',{method:'POST',headers:{origin:'https://cruiseapply.online','content-type':'application/json','sec-fetch-site':'same-origin'},body:JSON.stringify({voucherTypeId:product.data!.id,countryCode:'GH',email,name}),signal:AbortSignal.timeout(30000)});status=response.status;
 const data=await response.json();assert.equal(status,200,'Fresh public quote failed');amount=data.quote.charge_amount;assert.equal(data.quote.charge_currency,'GHS');assert.ok(Number.isInteger(amount));
}finally{
 const read=await db.from('guest_checkouts').select('id,applicant_id,contact_name').eq('contact_email',email);assert.ok(!read.error);
 for(const row of read.data??[]){assert.equal(row.contact_name,name);const payments=await db.from('payments').select('id').eq('guest_checkout_id',row.id);assert.ok(!payments.error);assert.equal(payments.data!.length,0,'Must never delete a payment');
 for(const [table,column,value] of [['payment_quotes','guest_checkout_id',row.id],['guest_checkouts','id',row.id],['audit_logs','actor_applicant_id',row.applicant_id],['applicant_principals','id',row.applicant_id]]){const result=await db.from(table).delete().eq(column,value);assert.ok(!result.error,'Fixture cleanup failed: '+table);}}
 cleaned=true;await writeFile('test-results/purchase-public-fresh.json',JSON.stringify({status,chargeAmount:amount,currency:'GHS',cleaned,paymentInitializations:0,paystackCalls:0},null,2));console.log(JSON.stringify({status,chargeAmount:amount,cleaned,paymentInitializations:0}));
}

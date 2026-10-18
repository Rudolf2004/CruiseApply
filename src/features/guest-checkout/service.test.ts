import { afterEach,beforeEach,expect,it,vi } from "vitest";
vi.mock("server-only",()=>({}));
vi.mock("@/lib/supabase/server",()=>({serviceDatabase:vi.fn()}));
vi.mock("@/lib/voucher-credentials",()=>({createApplicantPin:vi.fn()}));
vi.mock("@/features/payments/provider",()=>({paystack:{initialize:vi.fn()},paystackSecret:()=>process.env.PAYSTACK_SECRET_KEY??""}));
vi.mock("@/features/payments/service",()=>({paymentLimit:vi.fn(),verifyAndFulfill:vi.fn()}));
import {serviceDatabase} from "@/lib/supabase/server";
import {createApplicantPin} from "@/lib/voucher-credentials";
import {paymentLimit,verifyAndFulfill} from "@/features/payments/service";
import {guestClaim,guestStatus,guestVerify,guestQuote,guestResume} from "./service";
const raw=Buffer.alloc(32,9).toString("base64url"),rpc=vi.fn();
const checkout={checkout_id:"a752cd69-2810-4ae1-92a5-a49e067d3698",payment:{reference:"CA-original",status:"successful",charge_amount:15000,charge_currency:"GHS",product_name:"Application Access",paid_at:new Date().toISOString(),claim_available:true}};
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("APPLICANT_AUTH_ENABLED","true");vi.stubEnv("PAYSTACK_SECRET_KEY","sk_test_fixture");vi.mocked(serviceDatabase).mockReturnValue({rpc} as unknown as ReturnType<typeof serviceDatabase>);rpc.mockResolvedValue({data:checkout,error:null});vi.mocked(createApplicantPin).mockResolvedValue({pin:"12345678",pinHash:"s1:securehash"});});
afterEach(()=>vi.unstubAllEnvs());
it("refuses Live Mode and malformed capabilities before database access",async()=>{await expect(guestStatus("invalid")).rejects.toMatchObject({status:401});vi.stubEnv("PAYSTACK_SECRET_KEY","sk_live_fixture");await expect(guestStatus(raw)).rejects.toMatchObject({status:503});expect(rpc).not.toHaveBeenCalled();});
it("does not generate a PIN before authenticating capability and claim availability",async()=>{rpc.mockResolvedValue({data:{...checkout,payment:{...checkout.payment,claim_available:false}},error:null});await expect(guestClaim(raw)).rejects.toMatchObject({status:409});expect(createApplicantPin).not.toHaveBeenCalled();});
it("persists hashes only, after rate limiting, and never sends a PIN to SQL",async()=>{rpc.mockResolvedValueOnce({data:checkout,error:null}).mockResolvedValueOnce({data:{serial:"CRV-test",idle_expires_at:"2030-01-08T00:00:00Z",absolute_expires_at:"2030-01-31T00:00:00Z"},error:null});const result=await guestClaim(raw);expect(result.pin).toBe("12345678");expect(paymentLimit).toHaveBeenCalled();const call=rpc.mock.calls[1];expect(call[0]).toBe("claim_guest_voucher");expect(call[1].p_capability_hash).toMatch(/^[a-f0-9]{64}$/);expect(call[1].p_token_hash).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(rpc.mock.calls)).not.toContain(result.pin);expect(JSON.stringify(rpc.mock.calls)).not.toContain(result.sessionToken);});
it("cannot verify another payment reference using a valid checkout capability",async()=>{await expect(guestVerify(raw,"CA-other")).rejects.toMatchObject({status:404});expect(verifyAndFulfill).not.toHaveBeenCalled();await guestVerify(raw,"CA-original");expect(verifyAndFulfill).toHaveBeenCalledWith("CA-original");});

const purchase={voucherTypeId:"c253e6ea-5880-43bf-9d25-d9d46d938c46",countryCode:"GH",email:"buyer@example.com",name:"Buyer"};
const price={id:"167f2ca0-63ed-4ee4-a713-f9d62656b79f",product_name:"Application Access",country_code:"GH",region_code:null,validity_days:90,charge_amount:100,charge_currency:"GHS",display_amount:100,display_currency:"GHS",display_minor_units:2,exchange_rate:null,exchange_rate_source:null,exchange_rate_as_of:null,expires_at:"2030-01-01T00:00:00Z"};
it("allows another voucher after successful credential claim with a fresh capability",async()=>{
 rpc.mockResolvedValueOnce({data:{...checkout,payment:{...checkout.payment,claim_available:false}},error:null}).mockResolvedValueOnce({data:"new-checkout",error:null}).mockResolvedValueOnce({data:price,error:null});
 const result=await guestQuote(purchase,"client",raw);expect(result.raw).not.toBe(raw);expect(result.quote.charge_amount).toBe(100);expect(rpc.mock.calls.map(c=>c[0])).toEqual(["get_guest_checkout","begin_guest_checkout","create_guest_quote"]);
});
it.each(["pending","initialized","unknown"])("keeps %s payments protected from accidental replacement",async status=>{
 rpc.mockResolvedValue({data:{...checkout,payment:{...checkout.payment,status}},error:null});await expect(guestQuote(purchase,"client",raw)).rejects.toMatchObject({status:409});expect(rpc).toHaveBeenCalledTimes(1);
});
it("protects paid but unclaimed credentials",async()=>{await expect(guestQuote(purchase,"client",raw)).rejects.toMatchObject({status:409});expect(rpc).toHaveBeenCalledTimes(1);});
it("does not treat a failed status lookup as permission to replace checkout",async()=>{rpc.mockResolvedValue({data:null,error:{code:"08006"}});await expect(guestQuote(purchase,"client",raw)).rejects.toMatchObject({status:503});expect(rpc).toHaveBeenCalledTimes(1);});

it("permits an explicitly acknowledged separate purchase for the exact pending reference",async()=>{
 rpc.mockResolvedValueOnce({data:{...checkout,payment:{...checkout.payment,status:"pending",claim_available:false}},error:null}).mockResolvedValueOnce({data:"separate-checkout",error:null}).mockResolvedValueOnce({data:price,error:null});
 const result=await guestQuote({...purchase,startNewForReference:"CA-original"},"client",raw);expect(result.raw).not.toBe(raw);expect(rpc.mock.calls.map(c=>c[0])).toEqual(["get_guest_checkout","begin_guest_checkout","create_guest_quote"]);expect(verifyAndFulfill).not.toHaveBeenCalled();
});
it("rejects acknowledgment for another reference",async()=>{rpc.mockResolvedValue({data:{...checkout,payment:{...checkout.payment,status:"pending"}},error:null});await expect(guestQuote({...purchase,startNewForReference:"CA-other"},"client",raw)).rejects.toMatchObject({status:409});expect(rpc).toHaveBeenCalledTimes(1);});
it("never bypasses an unclaimed paid voucher using separate-purchase acknowledgment",async()=>{await expect(guestQuote({...purchase,startNewForReference:"CA-original"},"client",raw)).rejects.toMatchObject({status:409});expect(rpc).toHaveBeenCalledTimes(1);});

it("fresh visitors create a quote directly without earlier-payment lookup or provider calls",async()=>{
 rpc.mockResolvedValueOnce({data:"fresh-checkout",error:null}).mockResolvedValueOnce({data:price,error:null});
 await guestQuote(purchase,"fresh-client",null);expect(rpc.mock.calls.map(c=>c[0])).toEqual(["begin_guest_checkout","create_guest_quote"]);expect(verifyAndFulfill).not.toHaveBeenCalled();
});
it("an existing quote without a payment does not block price review",async()=>{
 rpc.mockResolvedValueOnce({data:{...checkout,payment:null},error:null}).mockResolvedValueOnce({data:"fresh-checkout",error:null}).mockResolvedValueOnce({data:price,error:null});
 expect((await guestQuote(purchase,"client",raw)).quote).toEqual(price);
});
it("resumes only the cookie-scoped saved checkout without initializing another payment",async()=>{
 rpc.mockResolvedValue({data:{...checkout,payment:{...checkout.payment,status:"pending"}},error:null});
 const maybeSingle=vi.fn().mockResolvedValue({data:{checkout_url:"https://checkout.paystack.com/existing"},error:null}),eq=vi.fn(),select=vi.fn();eq.mockReturnValue({eq,maybeSingle});select.mockReturnValue({eq});
 vi.mocked(serviceDatabase).mockReturnValue({rpc,from:vi.fn().mockReturnValue({select})} as unknown as ReturnType<typeof serviceDatabase>);
 expect(await guestResume(raw)).toEqual({reference:"CA-original",authorizationUrl:"https://checkout.paystack.com/existing"});expect(eq.mock.calls).toEqual([["reference","CA-original"],["guest_checkout_id",checkout.checkout_id]]);expect(rpc).toHaveBeenCalledTimes(1);
});
it("does not resume completed or foreign checkouts",async()=>{await expect(guestResume(raw)).rejects.toMatchObject({status:409});await expect(guestResume("invalid")).rejects.toMatchObject({status:401});});
it("rejects an unsafe saved provider URL",async()=>{
 rpc.mockResolvedValue({data:{...checkout,payment:{...checkout.payment,status:"pending"}},error:null});
 const maybeSingle=vi.fn().mockResolvedValue({data:{checkout_url:"https://evil.example/"},error:null}),eq=vi.fn();eq.mockReturnValue({eq,maybeSingle});
 vi.mocked(serviceDatabase).mockReturnValue({rpc,from:vi.fn().mockReturnValue({select:()=>({eq})})} as unknown as ReturnType<typeof serviceDatabase>);
 await expect(guestResume(raw)).rejects.toMatchObject({status:503});
});

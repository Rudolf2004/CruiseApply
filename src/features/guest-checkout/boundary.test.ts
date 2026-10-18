import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
vi.mock("./service",()=>({CHECKOUT_COOKIE:"__Host-cruiseapply_checkout",guestQuote:vi.fn(),guestInitialize:vi.fn(),guestStatus:vi.fn(),guestVerify:vi.fn(),guestClaim:vi.fn(),guestResume:vi.fn()}));
vi.mock("@/features/applicant-auth/service",()=>({authenticateApplicant:vi.fn(),logoutApplicantSession:vi.fn(),resolveApplicantSession:vi.fn()}));
import { quote, initialize, status, verify, claim, callback,resume } from "./handlers";
import { guestClaim,guestVerify,guestQuote,guestResume } from "./service";
const raw=Buffer.alloc(32,5).toString("base64url");
const request=(method="POST",origin="https://cruise.test")=>new Request("https://cruise.test/api/guest-checkout/claim",{method,headers:{origin,"content-type":"application/json",cookie:`__Host-cruiseapply_checkout=${raw}`},...(method==="GET"?{}:{body:"{}"})});
afterEach(()=>vi.unstubAllEnvs());
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("APPLICANT_AUTH_ENABLED","true");vi.stubEnv("NEXT_PUBLIC_APP_URL","https://cruise.test");});
describe("guest checkout boundary",()=>{
 it("keeps every operation unavailable without rollout",async()=>{vi.stubEnv("APPLICANT_AUTH_ENABLED","false");for(const fn of [quote,initialize,status,verify,claim,callback,resume])expect((await fn(request())).status).toBe(404);expect(guestClaim).not.toHaveBeenCalled();expect(guestQuote).not.toHaveBeenCalled();});
 it("rejects cross-origin credential claims",async()=>{expect((await claim(request("POST","https://evil.test"))).status).toBe(403);expect(guestClaim).not.toHaveBeenCalled();});
 it("delivers only the new PIN and serial, with an HttpOnly bounded session",async()=>{const expiry=new Date(Date.now()+86400000).toISOString();vi.mocked(guestClaim).mockResolvedValue({serial:"CRV-test",pin:"12345678",sessionToken:raw,idle_expires_at:expiry,absolute_expires_at:expiry});const response=await claim(request());expect(await response.json()).toEqual({serial:"CRV-test",pin:"12345678"});const cookie=response.headers.get("set-cookie")!;for(const part of ["Secure","HttpOnly","SameSite=lax","Path=/"])expect(cookie).toContain(part);expect(cookie).not.toContain("12345678");expect(response.headers.get("cache-control")).toContain("no-store");expect(response.headers.get("referrer-policy")).toBe("no-referrer");});
 it("does not leak database or credential errors",async()=>{vi.mocked(guestClaim).mockRejectedValue(new Error("private hash/body"));const response=await claim(request());expect(response.status).toBe(503);expect(await response.text()).not.toContain("private");expect(response.headers.get("set-cookie")).toBeNull();});
 it("rejects mismatched or duplicate callback references before verification",async()=>{const ref="CA-12345678-1234-1234-1234-123456789abc";for(const suffix of [`reference=${ref}&trxref=other`,`reference=${ref}&reference=${ref}`]){const response=await callback(new Request(`https://cruise.test/api/guest-checkout/callback?${suffix}`));expect(response.headers.get("location")).toContain("verification=pending");}expect(guestVerify).not.toHaveBeenCalled();});
 it("uses the checkout capability and exact callback reference without an account",async()=>{const ref="CA-12345678-1234-1234-1234-123456789abc";vi.mocked(guestVerify).mockResolvedValue({checkout_id:"id",payment:null});const response=await callback(new Request(`https://cruise.test/api/guest-checkout/callback?reference=${ref}&trxref=${ref}`,{headers:{cookie:`__Host-cruiseapply_checkout=${raw}`}}));expect(guestVerify).toHaveBeenCalledWith(raw,ref);expect(response.headers.get("location")).toBe("https://cruise.test/buy-voucher/result?verification=confirmed");});
});

it("resuming a checkout requires same-origin POST and forwards only the cookie capability",async()=>{
 expect((await resume(request("POST","https://evil.test"))).status).toBe(403);expect(guestResume).not.toHaveBeenCalled();
 vi.mocked(guestResume).mockResolvedValue({reference:"CA-existing",authorizationUrl:"https://checkout.paystack.com/existing"});
 const response=await resume(request());expect(response.status).toBe(200);expect(guestResume).toHaveBeenCalledWith(raw);expect(response.headers.get("cache-control")).toContain("no-store");expect(response.headers.get("set-cookie")).toBeNull();
});

import {afterEach,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {assertPaymentMode} from "./mode";
afterEach(()=>vi.unstubAllEnvs());
it("defaults to test and rejects live credentials",()=>{vi.stubEnv("PAYSTACK_MODE",undefined);expect(()=>assertPaymentMode("sk_test_fixture")).not.toThrow();expect(()=>assertPaymentMode("sk_live_fixture")).toThrow();});
it("requires explicit live authorization and HTTPS origin",()=>{vi.stubEnv("PAYSTACK_MODE","live");vi.stubEnv("PAYSTACK_LIVE_ENABLED","false");vi.stubEnv("NEXT_PUBLIC_APP_URL","https://cruise.example");expect(()=>assertPaymentMode("sk_live_fixture")).toThrow();vi.stubEnv("PAYSTACK_LIVE_ENABLED","true");expect(()=>assertPaymentMode("sk_live_fixture")).not.toThrow();expect(()=>assertPaymentMode("sk_test_fixture")).toThrow();for(const url of ["http://cruise.example","https://localhost:3443","https://127.0.0.1","invalid"]){vi.stubEnv("NEXT_PUBLIC_APP_URL",url);expect(()=>assertPaymentMode("sk_live_fixture")).toThrow();}});

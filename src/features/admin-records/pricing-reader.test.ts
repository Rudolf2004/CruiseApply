import {beforeEach,expect,it,vi} from "vitest";
import type {SupabaseClient} from "@supabase/supabase-js";
vi.mock("server-only",()=>({}));
const {factory}=vi.hoisted(()=>({factory:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({serviceDatabase:factory}));
import {staffPricingReader} from "./pricing-reader";
import {loadRecords} from "./service";
beforeEach(()=>{vi.clearAllMocks();});
it("denies anonymous, nonstaff, missing-role and failed role checks before privileged access",async()=>{
 for(const result of [{data:false,error:null},{data:null,error:null},{data:true,error:{message:"private"}}]){
  const db={rpc:vi.fn().mockResolvedValue(result)} as unknown as SupabaseClient;
  await expect(staffPricingReader(db)).rejects.toThrow("Staff configuration access unavailable.");
 }
 expect(factory).not.toHaveBeenCalled();
});
it("reads private pricing only after the authenticated database role check",async()=>{
 const chain={select:vi.fn(),order:vi.fn(),range:vi.fn().mockResolvedValue({data:[],count:0,error:null})};
 chain.select.mockReturnValue(chain);chain.order.mockReturnValue(chain);
 const reader={from:vi.fn().mockReturnValue(chain)};factory.mockReturnValue(reader);
 const rpc=vi.fn().mockResolvedValue({data:true,error:null}),db={rpc,from:vi.fn()} as unknown as SupabaseClient;
 for(const kind of ["regions","countries","exchange","overrides"] as const)await loadRecords(db,kind,{});
 expect(rpc).toHaveBeenCalledWith("is_admin");expect(db.from).not.toHaveBeenCalled();
 expect(reader.from.mock.calls.map(c=>c[0])).toEqual(["pricing_regions","pricing_countries","pricing_exchange_rates","voucher_price_overrides"]);
});
it("keeps payment reads on the caller's existing RLS client",async()=>{
 const chain={select:vi.fn(),order:vi.fn(),range:vi.fn().mockResolvedValue({data:[],count:0,error:null})};chain.select.mockReturnValue(chain);chain.order.mockReturnValue(chain);
 const db={from:vi.fn().mockReturnValue(chain)} as unknown as SupabaseClient;
 await loadRecords(db,"payments",{});expect(factory).not.toHaveBeenCalled();expect(db.from).toHaveBeenCalledWith("payments");
});

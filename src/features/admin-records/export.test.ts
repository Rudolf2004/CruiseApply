import {beforeEach,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const {user,load,rpc}=vi.hoisted(()=>({user:vi.fn(),load:vi.fn(),rpc:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({serviceDatabase:()=>({rpc})}));
vi.mock("@/lib/http",async original=>({...await original<object>(),apiUser:user}));
vi.mock("./service",()=>({loadRecords:load}));
import {GET} from "@/app/api/admin/records/[kind]/export/route";
import {ApiError} from "@/lib/http";
const request=new Request("http://localhost:3000/api/admin/records/payments/export"),context={params:Promise.resolve({kind:"payments"})};
beforeEach(()=>{vi.clearAllMocks();user.mockResolvedValue({user:{id:"verified-staff"},db:{session:"staff"}});rpc.mockResolvedValue({error:null});load.mockResolvedValue({rows:[{reference:"=formula",status:"successful",amount:15000,currency:"GHS",pin_hash:"SECRET"}],filters:{page:1}});});
it("denies unauthenticated and nonstaff exports before querying",async()=>{for(const status of [401,403]){user.mockRejectedValueOnce(new ApiError(status,"Denied"));expect((await GET(request,context)).status).toBe(status);}expect(load).not.toHaveBeenCalled();});
it("rejects private table selection",async()=>{expect((await GET(request,{params:Promise.resolve({kind:"voucher_access"})})).status).toBe(404);expect(load).not.toHaveBeenCalled();});
it("exports only allowlisted columns with no caching or credential data",async()=>{const r=await GET(request,context),body=await r.text();expect(r.status).toBe(200);expect(user).toHaveBeenCalledWith(true);expect(body).not.toContain("SECRET");expect(body).toContain("'=formula");expect(r.headers.get("cache-control")).toBe("no-store");expect(r.headers.get("content-disposition")).toContain("attachment");expect(load.mock.calls[0][0]).toEqual({session:"staff"});});

it("fails closed if export audit cannot be committed",async()=>{rpc.mockResolvedValue({error:{message:"PRIVATE"}});const r=await GET(request,context);expect(r.status).toBe(503);expect(await r.text()).not.toContain("PRIVATE");});

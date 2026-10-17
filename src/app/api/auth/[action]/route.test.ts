import {beforeEach,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const {database,serviceDatabase}=vi.hoisted(()=>({database:vi.fn(),serviceDatabase:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({database,serviceDatabase}));
import {POST} from "./route";
beforeEach(()=>vi.clearAllMocks());
it("rejects public registration before accessing auth or creating a user",async()=>{
 const response=await POST(new Request("http://localhost:3000/api/auth/register",{method:"POST",headers:{origin:"http://localhost:3000","content-type":"application/json"},body:JSON.stringify({email:"candidate@example.com",password:"unused",full_name:"Candidate"})}),{params:Promise.resolve({action:"register"})});
 expect(response.status).toBe(410);expect(database).not.toHaveBeenCalled();expect(serviceDatabase).not.toHaveBeenCalled();
});
it("retains same-origin protection for registration requests",async()=>{
 const response=await POST(new Request("http://localhost:3000/api/auth/register",{method:"POST",headers:{origin:"https://other.example"}}),{params:Promise.resolve({action:"register"})});expect(response.status).toBe(403);expect(database).not.toHaveBeenCalled();
});

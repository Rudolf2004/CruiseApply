import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("@supabase/ssr",()=>({createServerClient:vi.fn()}));
import { createServerClient } from "@supabase/ssr";
import { proxy } from "./proxy";
beforeEach(()=>vi.clearAllMocks());
it.each(["/api/applicant-auth/login","/api/applicant-portal","/api/applicant-portal/redeem","/applicant","/applicant/application"])("keeps %s out of Supabase session refresh",async path=>{
  const result=await proxy(new NextRequest("https://example.test"+path));
  expect(result.status).toBe(200);expect(result.headers.get("set-cookie")).toBeNull();expect(createServerClient).not.toHaveBeenCalled();
});

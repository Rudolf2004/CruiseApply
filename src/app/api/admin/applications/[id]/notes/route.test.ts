import { beforeEach,expect,it,vi } from "vitest";
vi.mock("server-only",() => ({}));
vi.mock("@/lib/supabase/server",() => ({ database: vi.fn() }));
vi.mock("@/lib/http",async () => ({ ...await vi.importActual<typeof import("@/lib/http")>("@/lib/http"),apiUser: vi.fn(),assertSameOrigin: vi.fn() }));
vi.mock("@/features/staff-notes/service",() => ({ addStaffNote: vi.fn(),listStaffNotes: vi.fn() }));
import { apiUser,ApiError,assertSameOrigin } from "@/lib/http";
import { addStaffNote,listStaffNotes } from "@/features/staff-notes/service";
import { GET,POST } from "./route";
const id = "5b0823b0-a0d1-4323-bf46-9c83e6f64dd8";
const params = { params: Promise.resolve({ id }) }; const db = {};
beforeEach(() => { vi.clearAllMocks(); vi.mocked(apiUser).mockResolvedValue({ user: { id: "session-staff" },db } as unknown as Awaited<ReturnType<typeof apiUser>>); });
it("requires staff for reads, uses RLS client and disables caching",async () => {
  vi.mocked(listStaffNotes).mockResolvedValue({ notes: [],total: 0,page: 2 });
  const result = await GET(new Request("http://localhost/notes?page=2"),params);
  expect(apiUser).toHaveBeenCalledWith(true); expect(listStaffNotes).toHaveBeenCalledWith(db,id,2); expect(result.headers.get("cache-control")).toBe("no-store");
});
it("passes only session identity as the actor",async () => {
  const data = { requestId: id,revision: 0,body: "Private note body." }; vi.mocked(addStaffNote).mockResolvedValue({ id });
  const request = new Request("http://localhost/notes",{ method: "POST",body: JSON.stringify(data) });
  expect((await POST(request,params)).status).toBe(200); expect(assertSameOrigin).toHaveBeenCalledWith(request); expect(apiUser).toHaveBeenCalledWith(true); expect(addStaffNote).toHaveBeenCalledWith("session-staff",id,data);
});
it("denies unauthorized reads and writes before note access",async () => {
  vi.mocked(apiUser).mockRejectedValue(new ApiError(403,"Denied"));
  expect((await GET(new Request("http://localhost/notes"),params)).status).toBe(403);
  expect((await POST(new Request("http://localhost/notes",{ method: "POST",body: "{}" }),params)).status).toBe(403);
  expect(listStaffNotes).not.toHaveBeenCalled(); expect(addStaffNote).not.toHaveBeenCalled();
});

import { beforeEach,expect,it,vi } from "vitest";
vi.mock("server-only",() => ({}));
vi.mock("@/lib/supabase/server",() => ({ serviceDatabase: vi.fn(),database: vi.fn() }));
import { serviceDatabase } from "@/lib/supabase/server";
import { addStaffNote,listStaffNotes } from "./service";
const id = "5b0823b0-a0d1-4323-bf46-9c83e6f64dd8";
const input = { requestId: id,revision: 3,body: "Private screening context." };
const rpc = vi.fn();
beforeEach(() => { vi.clearAllMocks(); vi.mocked(serviceDatabase).mockReturnValue({ rpc } as unknown as ReturnType<typeof serviceDatabase>); });
it("uses the trusted actor, unchanged revision context and retry ID",async () => {
  rpc.mockResolvedValue({ data: id,error: null });
  expect(await addStaffNote("session-staff",id,input)).toEqual({ id });
  expect(rpc).toHaveBeenCalledWith("add_application_note",{ p_actor_id: "session-staff",p_application_id: id,p_request_id: id,p_revision: 3,p_body: input.body });
});
it("rejects browser actor fields and invalid private note input before calling RPC",async () => {
  for (const data of [{ ...input,actor_id: "other" },{ ...input,body: "   " },{ ...input,body: "x".repeat(5001) },{ ...input,revision: -1 }]) await expect(addStaffNote("staff",id,data)).rejects.toThrow();
  expect(rpc).not.toHaveBeenCalled();
});
it("returns a conflict without retrying or exposing database error content",async () => {
  rpc.mockResolvedValue({ error: { code: "P0001",message: "Revision conflict private content" } });
  await expect(addStaffNote("staff",id,input)).rejects.toMatchObject({ status: 409 }); expect(rpc).toHaveBeenCalledTimes(1);
});
it("honors database staff-role revocation",async () => {
  rpc.mockResolvedValue({ error: { code: "P0001",message: "Administrator required" } });
  await expect(addStaffNote("staff",id,input)).rejects.toMatchObject({ status: 403 });
});

it("returns an empty out-of-range page with an RLS-scoped count",async () => {
  const range = vi.fn().mockResolvedValue({ error: { code: "PGRST103" },data: null });
  const query = { eq: vi.fn(),order: vi.fn(),range }; query.eq.mockReturnValue(query); query.order.mockReturnValue(query);
  const countEq = vi.fn().mockResolvedValue({ error: null,count: 1 });
  const select = vi.fn().mockReturnValueOnce(query).mockReturnValueOnce({ eq: countEq });
  const db = { from: vi.fn().mockReturnValue({ select }) } as unknown as Parameters<typeof listStaffNotes>[0];
  expect(await listStaffNotes(db,id,2)).toEqual({ notes: [],total: 1,page: 2 });
  expect(query.eq).toHaveBeenCalledWith("application_id",id); expect(countEq).toHaveBeenCalledWith("application_id",id); expect(range).toHaveBeenCalledWith(20,39);
  expect(serviceDatabase).not.toHaveBeenCalled();
});
it("does not turn arbitrary note read errors into successful empty results",async () => {
  const query = { eq: vi.fn(),order: vi.fn(),range: vi.fn().mockResolvedValue({ error: { code: "offline" } }) }; query.eq.mockReturnValue(query); query.order.mockReturnValue(query);
  const db = { from: () => ({ select: () => query }) } as unknown as Parameters<typeof listStaffNotes>[0];
  await expect(listStaffNotes(db,id)).rejects.toThrow("Staff notes unavailable.");
});

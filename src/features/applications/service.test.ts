import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth",()=>({requireUser:vi.fn()}));
import { requireUser } from "@/lib/auth";
vi.mock("@/lib/supabase/server", () => ({ serviceDatabase: vi.fn() }));
import { serviceDatabase } from "@/lib/supabase/server";
import { loadStaffApplication, loadApplication, saveDraft, submitApplication } from "./service";
import { emptyDraft } from "./schema";
const id = "5b0823b0-a0d1-4323-bf46-9c83e6f64dd8";
const rpc = vi.fn(); const eq = vi.fn(); const lookup = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); const query = { eq,maybeSingle: lookup }; eq.mockReturnValue(query);
  vi.mocked(serviceDatabase).mockReturnValue({ rpc,from: () => ({ select: () => query }) } as unknown as ReturnType<typeof serviceDatabase>);
});
it("saves a validated draft with server-derived ownership and the exact expected revision", async () => {
  rpc.mockResolvedValue({ data: { revision: 4 },error: null });
  expect(await saveDraft("owner",id,{ revision: 3,draft: emptyDraft,user_id: "attacker",status: "submitted" })).toEqual({ revision: 4 });
  expect(rpc).toHaveBeenCalledWith("save_application_draft", { p_user_id: "owner",p_application_id: id,p_revision: 3,p_data: emptyDraft });
});
it("surfaces revision conflicts instead of retrying with an unchecked revision", async () => {
  rpc.mockResolvedValue({ error: { code: "P0001",message: "Revision conflict" } });
  await expect(saveDraft("owner",id,{ revision: 3,draft: emptyDraft })).rejects.toMatchObject({ status: 409 });
  expect(rpc).toHaveBeenCalledTimes(1);
});
it("requires an explicit declaration before any application lookup or RPC", async () => {
  await expect(submitApplication("owner",id,{ revision: 0,declaration: false })).rejects.toThrow();
  expect(serviceDatabase).not.toHaveBeenCalled();
});
it("checks ownership before reading child records or permitting submission", async () => {
  lookup.mockResolvedValue({ data: null,error: null });
  await expect(loadApplication("6cd36a71-4a37-4d49-9262-5b87387b3acf",id)).rejects.toMatchObject({ status: 404 });
  expect(eq).toHaveBeenCalledWith("user_id","6cd36a71-4a37-4d49-9262-5b87387b3acf");
  await expect(submitApplication("6cd36a71-4a37-4d49-9262-5b87387b3acf",id,{ revision: 0,declaration: true })).rejects.toMatchObject({ status: 404 });
  expect(rpc).not.toHaveBeenCalled();
});

it("requires a verified staff session before looking up principal-owned applications",async()=>{
  vi.mocked(requireUser).mockRejectedValueOnce(new Error("Staff denied"));
  await expect(loadStaffApplication(id)).rejects.toThrow("Staff denied");
  expect(requireUser).toHaveBeenCalledWith(true);
  expect(serviceDatabase).not.toHaveBeenCalled();
});
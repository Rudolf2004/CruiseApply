import { beforeEach,expect,it,vi } from "vitest";
vi.mock("server-only",() => ({}));
vi.mock("@/lib/supabase/server",() => ({ serviceDatabase: vi.fn() }));
import { serviceDatabase } from "@/lib/supabase/server";
import { reviewApplication } from "./service";
import { reviewSchema,reviewTransitions } from "./schema";
const id = "5b0823b0-a0d1-4323-bf46-9c83e6f64dd8";
const input = { requestId: id,revision: 3,status: "under_review",message: "Screening has started." };
const rpc = vi.fn();
beforeEach(() => { vi.clearAllMocks(); vi.mocked(serviceDatabase).mockReturnValue({ rpc } as unknown as ReturnType<typeof serviceDatabase>); });
it("derives the RPC actor from the server argument and preserves the retry key",async () => {
  rpc.mockResolvedValue({ data: { revision: 4 },error: null });
  await reviewApplication("session-staff",id,input);
  expect(rpc).toHaveBeenCalledWith("review_application",{ p_actor_id: "session-staff",p_application_id: id,p_request_id: id,p_revision: 3,p_status: "under_review",p_message: input.message });
});
it("rejects actor spoofing and withdrawal before database access",async () => {
  await expect(reviewApplication("staff",id,{ ...input,actor_id: "other" })).rejects.toThrow();
  await expect(reviewApplication("staff",id,{ ...input,status: "withdrawn" })).rejects.toThrow();
  expect(rpc).not.toHaveBeenCalled();
});
it("requires an applicant-visible message and bounded revision",() => {
  expect(reviewSchema.safeParse({ ...input,message: "   " }).success).toBe(false);
  expect(reviewSchema.safeParse({ ...input,revision: -1 }).success).toBe(false);
});
it("surfaces stale/conflicting decisions without automatic retries",async () => {
  rpc.mockResolvedValue({ error: { code: "P0001",message: "Revision conflict" } });
  await expect(reviewApplication("staff",id,input)).rejects.toMatchObject({ status: 409 });
  expect(rpc).toHaveBeenCalledTimes(1);
});
it("honors database staff-role revocation",async () => {
  rpc.mockResolvedValue({ error: { code: "P0001",message: "Administrator required" } });
  await expect(reviewApplication("staff",id,input)).rejects.toMatchObject({ status: 403 });
});
it("excludes applicant withdrawal and terminal reopening from staff choices",() => {
  for (const choices of Object.values(reviewTransitions)) expect(choices).not.toContain("withdrawn");
  for (const status of ["draft","accepted","unsuccessful","withdrawn"]) expect(reviewTransitions[status]).toBeUndefined();
});

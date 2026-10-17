import { beforeEach,expect,it,vi } from "vitest";
vi.mock("server-only",() => ({}));
vi.mock("@/lib/supabase/server",() => ({ serviceDatabase: vi.fn() }));
import { serviceDatabase } from "@/lib/supabase/server";
import { markNotificationRead } from "./service";
import { notificationHref } from "./links";
const id = "5b0823b0-a0d1-4323-bf46-9c83e6f64dd8";
const query = { update: vi.fn(),select: vi.fn(),eq: vi.fn(),is: vi.fn(),maybeSingle: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  for (const method of [query.update,query.select,query.eq,query.is]) method.mockReturnValue(query);
  vi.mocked(serviceDatabase).mockReturnValue({ from: () => query } as unknown as ReturnType<typeof serviceDatabase>);
});
it("scopes the mutation to the owner and unread rows",async () => {
  query.maybeSingle.mockResolvedValue({ data: { id,read_at: "first" },error: null });
  expect(await markNotificationRead("owner",id)).toEqual({ id,read_at: "first" });
  expect(query.eq).toHaveBeenCalledWith("user_id","owner"); expect(query.is).toHaveBeenCalledWith("read_at",null);
  expect(Object.keys(query.update.mock.calls[0][0])).toEqual(["read_at"]);
});
it("returns the original read time when a request is replayed",async () => {
  query.maybeSingle.mockResolvedValueOnce({ data: null,error: null }).mockResolvedValueOnce({ data: { id,read_at: "original" },error: null });
  expect(await markNotificationRead("owner",id)).toEqual({ id,read_at: "original" });
});
it("returns 404 for foreign or missing notifications",async () => {
  query.maybeSingle.mockResolvedValue({ data: null,error: null });
  await expect(markNotificationRead("foreign",id)).rejects.toMatchObject({ status: 404 });
  expect(query.eq.mock.calls.filter(([column]) => column === "user_id")).toEqual([["user_id","foreign"],["user_id","foreign"]]);
});
it("does not fall back to a lookup after a failed write",async () => {
  query.maybeSingle.mockResolvedValue({ data: null,error: { message: "offline" } });
  await expect(markNotificationRead("owner",id)).rejects.toThrow("Notification update unavailable"); expect(query.maybeSingle).toHaveBeenCalledTimes(1);
});
it("rejects malformed identifiers before database access",async () => {
  await expect(markNotificationRead("owner","bad")).rejects.toThrow(); expect(serviceDatabase).not.toHaveBeenCalled();
});
it("allows dashboard record links and rejects external or encoded redirects",() => {
  expect(notificationHref(`/dashboard/applications/${id}`)).toBe(`/dashboard/applications/${id}`);
  for (const value of [null,"https://evil.test","//evil.test","/dashboard/../login","/dashboard/%2f%2fevil","/dashboard\\evil","javascript:alert(1)","/dashboard?next=https://evil.test"]) expect(notificationHref(value)).toBeNull();
});

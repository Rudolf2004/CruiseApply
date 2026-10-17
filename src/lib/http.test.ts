import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./supabase/server", () => ({ database: vi.fn() }));
import { database } from "./supabase/server";
import { appUrl } from "./config";
import { ApiError, apiUser, assertSameOrigin, readBody, readJson } from "./http";

describe("request security boundaries", () => {
  beforeEach(() => vi.clearAllMocks());
  it("rejects cross-origin requests and absent origins", () => {
    expect(() => assertSameOrigin(new Request("http://localhost/api/profile", { headers: { origin: "https://untrusted.example" } }))).toThrow(ApiError);
    expect(() => assertSameOrigin(new Request("http://localhost/api/profile"))).toThrow(ApiError);
    expect(() => assertSameOrigin(new Request("http://localhost/api/profile", { headers: { origin: new URL(appUrl).origin } }))).not.toThrow();
  });
  it("bounds request bodies without trusting Content-Length", async () => {
    await expect(readBody(new Request("http://localhost/api", { method: "POST", body: "too much data" }), 3)).rejects.toMatchObject({ status: 413 });
  });
  it("rejects malformed JSON", async () => {
    await expect(readJson(new Request("http://localhost/api", { method: "POST", body: "{" }))).rejects.toMatchObject({ status: 400 });
    await expect(readJson(new Request("http://localhost/api", { method: "POST", body: '{"name":"Applicant"}' }))).resolves.toEqual({ name: "Applicant" });
  });
  it("requires a provider-verified user before reading their profile", async () => {
    const from = vi.fn();
    vi.mocked(database).mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null }, error: null }) }, from } as unknown as Awaited<ReturnType<typeof database>>);
    await expect(apiUser()).rejects.toMatchObject({ status: 401 });
    expect(from).not.toHaveBeenCalled();
  });
  it("does not trust an admin claim in user-editable metadata", async () => {
    const eq = vi.fn(() => ({ single: async () => ({ data: { id: "owner", role: "applicant" }, error: null }) }));
    vi.mocked(database).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "owner", user_metadata: { role: "admin" } } }, error: null }) },
      from: () => ({ select: () => ({ eq }) })
    } as unknown as Awaited<ReturnType<typeof database>>);
    await expect(apiUser(true)).rejects.toMatchObject({ status: 403 });
    expect(eq).toHaveBeenCalledWith("id", "owner");
  });
});

import { beforeEach,expect,it,vi } from "vitest";
vi.mock("server-only",() => ({}));
vi.mock("@/lib/supabase/server",() => ({ serviceDatabase: vi.fn(),database: vi.fn() }));
vi.mock("@/lib/http",async () => ({ ...await vi.importActual<typeof import("@/lib/http")>("@/lib/http"),apiUser: vi.fn() }));
import { apiUser } from "@/lib/http";
import { serviceDatabase } from "@/lib/supabase/server";
import { GET } from "./route";
const id = "5b0823b0-a0d1-4323-bf46-9c83e6f64dd8";
const documentId = "6b0823b0-a0d1-4323-bf46-9c83e6f64dd8";
const lookup = vi.fn(),download = vi.fn(),insert = vi.fn(),eq = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); const query = { eq,maybeSingle: lookup }; eq.mockReturnValue(query);
  vi.mocked(apiUser).mockResolvedValue({ user: { id: "staff" },db: { from: () => ({ select: () => query }) } } as unknown as Awaited<ReturnType<typeof apiUser>>);
  lookup.mockResolvedValue({ data: { storage_path: "trusted/private.pdf",name: "review.pdf",mime_type: "application/pdf" },error: null });
  download.mockResolvedValue({ data: new Blob(["private"]),error: null }); insert.mockResolvedValue({ error: null });
  vi.mocked(serviceDatabase).mockReturnValue({ from: () => ({ insert }),storage: { from: () => ({ download }) } } as unknown as ReturnType<typeof serviceDatabase>);
});
const run = () => GET(new Request("http://localhost"),{ params: Promise.resolve({ id,documentId }) });
it("checks staff and application/document scope before serving an audited attachment",async () => {
  const response = await run(); expect(response.status).toBe(200);
  expect(apiUser).toHaveBeenCalledWith(true); expect(eq).toHaveBeenCalledWith("application_id",id); expect(eq).toHaveBeenCalledWith("id",documentId);
  expect(download).toHaveBeenCalledWith("trusted/private.pdf");
  expect(insert).toHaveBeenCalledWith({ actor_id: "staff",action: "application_document_downloaded",target_type: "application_documents",target_id: documentId,metadata: { application_id: id } });
  expect(response.headers.get("content-disposition")).toContain("attachment"); expect(response.headers.get("cache-control")).toContain("no-store");
});
it("does not serve a file if audit persistence fails",async () => {
  insert.mockResolvedValue({ error: { message: "offline" } });
  const response = await run(); expect(response.status).toBe(500); expect(await response.text()).not.toBe("private");
});
it("does not fetch storage for an absent or inaccessible document",async () => {
  lookup.mockResolvedValue({ data: null,error: null }); expect((await run()).status).toBe(404); expect(download).not.toHaveBeenCalled();
});

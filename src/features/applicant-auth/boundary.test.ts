import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes, scryptSync } from "node:crypto";
vi.mock("server-only", () => ({}));
const { rpc, factory } = vi.hoisted(() => ({ rpc: vi.fn(), factory: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ serviceDatabase: factory, database: vi.fn() }));
vi.mock("@/lib/voucher-credentials", async original => {
  const actual = await original<typeof import("@/lib/voucher-credentials")>();
  return { ...actual, verifyVoucherPin: vi.fn(actual.verifyVoucherPin) };
});
import { verifyVoucherPin } from "@/lib/voucher-credentials";
import { POST as login } from "@/app/api/applicant-auth/login/route";
import { POST as session } from "@/app/api/applicant-auth/session/route";
import { POST as logout } from "@/app/api/applicant-auth/logout/route";
import { authenticateApplicant, resolveApplicantSession, logoutApplicantSession } from "./service";
import { APPLICANT_COOKIE, applicantToken, tokenDigest } from "./policy";

const ids = {
  session_id: "10000000-0000-4000-8000-000000000001", voucher_access_id: "10000000-0000-4000-8000-000000000002",
  applicant_id: "10000000-0000-4000-8000-000000000003", voucher_id: "10000000-0000-4000-8000-000000000004",
  payment_id: "10000000-0000-4000-8000-000000000005", application_id: "10000000-0000-4000-8000-000000000006",
};
const pin = "01234567", salt = "ab".repeat(16);
const hash = `s1:${salt}:${scryptSync(pin, salt, 32).toString("hex")}`;
const material = { voucher_id: ids.voucher_id, pin_hash: hash, credential_version: 7 };
const raw = randomBytes(32).toString("base64url");
const scope = () => ({ ...ids, idle_expires_at: new Date(Date.now()+86400000).toISOString(), absolute_expires_at: new Date(Date.now()+10*86400000).toISOString() });
function request(path = "login", body: unknown = { serial: "crv-2026-00000003", pin }, extra: Record<string,string> = {}) {
  return new Request(`https://cruiseapply.test/api/applicant-auth/${path}`, { method: "POST", headers: { origin: "https://cruiseapply.test", "content-type": "application/json", ...extra }, body: JSON.stringify(body) });
}
async function defaults(name: string) {
  if (name === "consume_request_limit") return { data: true, error: null };
  if (name === "get_voucher_login_material") return { data: [material], error: null };
  if (name === "open_verified_voucher_session" || name === "resolve_voucher_session") return { data: [scope()], error: null };
  if (name === "logout_voucher_session") return { data: null, error: null };
  throw new Error("Unexpected RPC");
}
describe("staged applicant auth boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("APPLICANT_AUTH_ENABLED", "true"); // isolated test only, no server or hosted rollout
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://cruiseapply.test");
    vi.stubEnv("APPLICANT_AUTH_TRUSTED_IP_HEADER", "");
    factory.mockReturnValue({ rpc }); rpc.mockImplementation(defaults);
  });
  afterEach(() => vi.unstubAllEnvs());
  it.each([undefined, "false", "TRUE"])("fails closed for rollout %s before DB/cookies", async flag => {
    vi.stubEnv("APPLICANT_AUTH_ENABLED", flag);
    for (const handler of [login, session, logout]) {
      const result = await handler(request());
      expect(result.status).toBe(404); expect(result.headers.get("set-cookie")).toBeNull();
    }
    await expect(authenticateApplicant({}, "shared")).rejects.toMatchObject({ status: 404 });
    await expect(resolveApplicantSession(raw)).rejects.toMatchObject({ status: 404 });
    await expect(logoutApplicantSession(raw)).rejects.toMatchObject({ status: 404 });
    expect(factory).not.toHaveBeenCalled();
  });
  it.each(["https://attacker.test", "null", ""])("rejects origin %s before work", async origin => {
    for (const handler of [login,session,logout]) expect((await handler(request("login", {}, {origin}))).status).toBe(403);
    expect(factory).not.toHaveBeenCalled();
  });
  it("requires configured HTTPS and rejects cross-site fetches", async () => {
    expect((await login(request("login", {}, {"sec-fetch-site":"cross-site"}))).status).toBe(403);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    expect((await login(request())).status).toBe(503); expect(factory).not.toHaveBeenCalled();
  });
  it("verifies leading-zero PIN and uses only server material/hash to create the secure cookie", async () => {
    const result = await login(request());
    expect(result.status).toBe(200); expect(await result.json()).toEqual({authenticated:true});
    const set = result.headers.get("set-cookie")!;
    const token = set.split(";")[0].split("=")[1];
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(set).toContain("HttpOnly"); expect(set).toContain("Secure"); expect(set).toContain("SameSite=lax"); expect(set).toContain("Path=/"); expect(set).not.toContain("Domain=");
    expect(set.startsWith(APPLICANT_COOKIE+"=")).toBe(true); expect(set).not.toContain(pin);
    expect(rpc).toHaveBeenCalledWith("get_voucher_login_material", {p_serial:"CRV-2026-00000003"});
    expect(rpc).toHaveBeenCalledWith("open_verified_voucher_session", {p_serial:"CRV-2026-00000003",p_verified_pin_hash:hash,p_expected_credential_version:7,p_token_hash:tokenDigest(token)});
    expect(result.headers.get("cache-control")).toContain("no-store"); expect(result.headers.get("vary")).toBe("Cookie");
    const calls = rpc.mock.calls.map(([name])=>name);
    expect(calls.slice(0,3)).toEqual(Array(3).fill("consume_request_limit"));
  });
  it("unknown serial and wrong PIN get identical generic errors and one scrypt each", async () => {
    const wrong=await login(request("login", {serial:"CRV-2026-00000003",pin:"99999999"}));
    const body=await wrong.json(); expect(wrong.status).toBe(401);
    rpc.mockImplementation(async name=>name==="get_voucher_login_material"?{data:[],error:null}:defaults(name));
    const unknown=await login(request()); expect(unknown.status).toBe(401); expect(await unknown.json()).toEqual(body);
    expect(verifyVoucherPin).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls.some(([name])=>name==="open_verified_voucher_session")).toBe(false);
  });
  it.each([{actor_id:ids.applicant_id}, {p_verified_pin_hash:hash}, {pin:1234567}])("rejects browser proof/actor or non-string PIN", async injected => {
    const result=await login(request("login", {serial:"CRV-2026-00000003",pin,...injected}));
    expect(result.status).toBe(401);expect(verifyVoucherPin).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls.some(([name])=>name==="get_voucher_login_material")).toBe(false);
  });
  it("unsupported hash encoding fails closed with dummy scrypt", async () => {
    rpc.mockImplementation(async name=>name==="get_voucher_login_material"?{data:[{...material,pin_hash:hash.replace("s1:","s2:")}],error:null}:defaults(name));
    expect((await login(request())).status).toBe(401); expect(verifyVoucherPin).toHaveBeenCalledTimes(1);
  });
  it("throttles before lookup/scrypt and fails closed if the limiter is unavailable", async () => {
    rpc.mockResolvedValue({data:false,error:null});
    const limited=await login(request());expect(limited.status).toBe(429);expect(limited.headers.get("retry-after")).toBe("900");expect(verifyVoucherPin).not.toHaveBeenCalled();
    rpc.mockResolvedValue({data:null,error:{message:"sensitive provider error"}});
    const failed=await login(request());expect(failed.status).toBe(503);expect(await failed.text()).not.toContain("sensitive");
  });
  it("ignores spoofed forwarding headers by default and hashes explicitly trusted client keys", async () => {
    await login(request("login",{serial:"CRV-2026-00000003",pin},{"x-forwarded-for":"1.2.3.4","cf-connecting-ip":"1.2.3.4"}));
    expect(rpc).toHaveBeenCalledWith("consume_request_limit",expect.objectContaining({p_key:"applicant-auth:client:shared"}));
    vi.stubEnv("APPLICANT_AUTH_TRUSTED_IP_HEADER","cf-connecting-ip");
    vi.clearAllMocks();rpc.mockImplementation(defaults);
    expect((await login(request())).status).toBe(503);expect(factory).not.toHaveBeenCalled();
    await login(request("login",{serial:"CRV-2026-00000003",pin},{"cf-connecting-ip":"203.0.113.1"}));
    expect(rpc).toHaveBeenCalledWith("consume_request_limit",expect.objectContaining({p_key:"applicant-auth:client:"+tokenDigest("203.0.113.1")}));
  });
  it("rejects oversized and non-JSON login bodies without exposing values", async () => {
    const tooLarge=await login(request("login",{serial:"x".repeat(3000),pin}));expect(tooLarge.status).toBe(401);
    expect((await login(request("login",{}, {"content-type":"text/plain"}))).status).toBe(401);expect(factory).not.toHaveBeenCalled();
  });
  it("maps locked stale-proof errors to generic denial without setting a cookie", async () => {
    rpc.mockImplementation(async name=>name==="open_verified_voucher_session"?{data:null,error:{code:"P0001",message:hash}}:defaults(name));
    const result=await login(request());expect(result.status).toBe(401);expect(result.headers.get("set-cookie")).toBeNull();expect(await result.text()).not.toContain(hash);
  });
  it("refresh resolves only the applicant cookie, hides IDs and caps cookie lifetime", async () => {
    const capped={...scope(),idle_expires_at:new Date(Date.now()+8*86400000).toISOString(),absolute_expires_at:new Date(Date.now()+86400000).toISOString()};
    rpc.mockResolvedValue({data:[capped],error:null});
    const result=await session(request("session",{}, {cookie:`staff-cookie=staff-token; ${APPLICANT_COOKIE}=${raw}`}));
    expect(result.status).toBe(200);expect(await result.json()).toEqual({authenticated:true});
    expect(rpc).toHaveBeenCalledWith("resolve_voucher_session",{p_token_hash:tokenDigest(raw)});
    const set=result.headers.get("set-cookie")!;expect(set).not.toContain("staff-cookie");expect(set).toContain(new Date(capped.absolute_expires_at).toUTCString());
  });
  it("missing, malformed and duplicate cookies cannot resolve a scope", async () => {
    for(const cookie of ["staff-cookie=abc",`${APPLICANT_COOKIE}=bad`,`${APPLICANT_COOKIE}=${raw}; ${APPLICANT_COOKIE}=${raw}`]) {
      const result=await session(request("session",{}, {cookie}));expect(result.status).toBe(401);expect(result.headers.get("set-cookie")).toContain("Max-Age=0");
    }
    expect(factory).not.toHaveBeenCalled();
    expect(applicantToken(request("session",{}, {cookie:`${APPLICANT_COOKIE}=%${raw}`}))).toBeNull();
  });
  it("expired/revoked sessions clear only the applicant cookie", async () => {
    rpc.mockResolvedValue({data:[],error:null});
    const result=await session(request("session",{}, {cookie:`${APPLICANT_COOKIE}=${raw}`}));
    expect(result.status).toBe(401);expect(result.headers.get("set-cookie")).toContain(`${APPLICANT_COOKIE}=;`);
  });
  it("logout confirms server revocation before clearing cookie; outages stay retryable", async () => {
    const req=()=>request("logout",{}, {cookie:`${APPLICANT_COOKIE}=${raw}`});
    const result=await logout(req());expect(result.status).toBe(200);expect(result.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(rpc).toHaveBeenCalledWith("logout_voucher_session",{p_token_hash:tokenDigest(raw)});
    rpc.mockResolvedValue({data:null,error:{message:"private database detail"}});
    const failed=await logout(req());expect(failed.status).toBe(503);expect(failed.headers.get("set-cookie")).toBeNull();expect(await failed.text()).not.toContain("private database detail");
  });
});

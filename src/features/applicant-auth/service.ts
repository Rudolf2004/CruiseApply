import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { serviceDatabase } from "@/lib/supabase/server";
import { verifyVoucherPin } from "@/lib/voucher-credentials";
import { ApplicantAuthError, assertApplicantRollout, tokenDigest, validToken } from "./policy";

const dummyHash = `s1:${"0".repeat(32)}:${"0".repeat(64)}`;
const credentials = z.object({
  serial: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{8,100}$/),
  pin: z.string().regex(/^\d{8}$/),
}).strict();
const sessionShape = z.object({
  session_id: z.uuid(), voucher_access_id: z.uuid(), applicant_id: z.uuid(), voucher_id: z.uuid(),
  idle_expires_at: z.iso.datetime({ offset: true }), absolute_expires_at: z.iso.datetime({ offset: true }),
});
const scopeShape = sessionShape.extend({ payment_id: z.uuid(), application_id: z.uuid().nullable() });
export type ApplicantScope = z.infer<typeof scopeShape>;
type Database = ReturnType<typeof serviceDatabase>;
async function limit(db: Database, key: string, count: number, seconds: number) {
  const result = await db.rpc("consume_request_limit", { p_key: `applicant-auth:${key}`, p_limit: count, p_seconds: seconds });
  if (result.error || typeof result.data !== "boolean") throw new ApplicantAuthError(503);
  if (!result.data) throw new ApplicantAuthError(429);
}
function one(data: unknown): unknown {
  if (!Array.isArray(data) || data.length > 1) throw new ApplicantAuthError(503);
  return data[0];
}
export async function authenticateApplicant(input: unknown, clientKey: string) {
  assertApplicantRollout();
  const db = serviceDatabase();
  const parsed = credentials.safeParse(input);
  await limit(db, "login-global", 120, 60);
  await limit(db, `client:${clientKey}`, 30, 900);
  // Bad-shaped requests share a bucket; never place PIN/body/email in a key.
  const serial = parsed.success ? parsed.data.serial : "invalid-input";
  await limit(db, `serial:${tokenDigest(serial)}`, 8, 900);
  let material: { voucher_id: string; pin_hash: string; credential_version: number } | undefined;
  if (parsed.success) {
    const result = await db.rpc("get_voucher_login_material", { p_serial: serial });
    if (result.error) throw new ApplicantAuthError(503);
    const row = one(result.data);
    if (row !== undefined) {
      const validated = z.object({ voucher_id: z.uuid(), pin_hash: z.string().max(200), credential_version: z.number().int().nonnegative() }).safeParse(row);
      if (!validated.success) throw new ApplicantAuthError(503);
      material = validated.data;
    }
  }
  const supported = !!material && /^s1:[a-f0-9]{32}:[a-f0-9]{64}$/.test(material.pin_hash);
  // Always perform one scrypt derivation for non-throttled invalid/missing credentials.
  const verified = await verifyVoucherPin(parsed.success ? parsed.data.pin : "00000000", supported ? material!.pin_hash : dummyHash);
  if (!parsed.success || !material || !supported || !verified) throw new ApplicantAuthError(401);
  const rawToken = randomBytes(32).toString("base64url");
  const opened = await db.rpc("open_verified_voucher_session", {
    p_serial: serial, p_verified_pin_hash: material.pin_hash,
    p_expected_credential_version: material.credential_version, p_token_hash: tokenDigest(rawToken),
  });
  // A locked proof/version mismatch is an authentication failure, not permission
  // to retry with a legacy hash or silently issue another credential.
  if (opened.error) throw new ApplicantAuthError(opened.error.code === "P0001" ? 401 : 503);
  const session = sessionShape.safeParse(one(opened.data));
  if (!session.success || session.data.voucher_id !== material.voucher_id) throw new ApplicantAuthError(503);
  return { rawToken, session: session.data };
}
export async function resolveApplicantSession(rawToken: string | null): Promise<ApplicantScope> {
  assertApplicantRollout();
  if (!rawToken || !validToken(rawToken)) throw new ApplicantAuthError(401);
  const result = await serviceDatabase().rpc("resolve_voucher_session", { p_token_hash: tokenDigest(rawToken) });
  if (result.error) throw new ApplicantAuthError(503);
  const row = one(result.data);
  if (!row) throw new ApplicantAuthError(401);
  const scope = scopeShape.safeParse(row);
  if (!scope.success) throw new ApplicantAuthError(503);
  return scope.data;
}
export async function logoutApplicantSession(rawToken: string | null) {
  assertApplicantRollout();
  if (!rawToken || !validToken(rawToken)) return;
  const result = await serviceDatabase().rpc("logout_voucher_session", { p_token_hash: tokenDigest(rawToken) });
  if (result.error) throw new ApplicantAuthError(503);
}

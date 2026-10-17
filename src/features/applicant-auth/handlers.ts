import "server-only";
import { NextResponse } from "next/server";
import { readBody } from "@/lib/http";
import { APPLICANT_COOKIE, ApplicantAuthError, applicantToken, assertApplicantOrigin, clientLimitKey } from "./policy";
import { authenticateApplicant, logoutApplicantSession, resolveApplicantSession } from "./service";

const headers = { "Cache-Control": "private, no-store, max-age=0", "Pragma": "no-cache", "Vary": "Cookie", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const cookieOptions = { secure: true, httpOnly: true, sameSite: "lax" as const, path: "/" };
function response(body: object, status = 200) { return NextResponse.json(body, { status, headers }); }
function clear(response: NextResponse) { response.cookies.set(APPLICANT_COOKIE, "", { ...cookieOptions, expires: new Date(0), maxAge: 0 }); }
export function setSession(response: NextResponse, rawToken: string, session: { idle_expires_at: string; absolute_expires_at: string }) {
  const expires = Math.min(Date.parse(session.idle_expires_at), Date.parse(session.absolute_expires_at));
  if (!Number.isFinite(expires) || expires <= Date.now()) throw new ApplicantAuthError(401);
  // Use the database's absolute timestamp. Next's cookie serializer recomputes
  // Expires when Max-Age is supplied; avoiding that keeps this cap exact.
  response.cookies.set(APPLICANT_COOKIE, rawToken, { ...cookieOptions, expires: new Date(expires) });
}
export function failure(error: unknown, clearInvalidSession = false) {
  const status = error instanceof ApplicantAuthError ? error.status : 503;
  const messages: Record<number,string> = {
    404: "Not found.", 403: "This request is not permitted.",
    401: "Unable to authenticate. Check your credentials or sign in again.",
    429: "Please wait before trying again.", 503: "Authentication is temporarily unavailable. Please try again.",
  };
  const result = response({ error: messages[status] ?? messages[503] }, status);
  if (status === 429) result.headers.set("Retry-After", "900");
  if (clearInvalidSession && status === 401) clear(result);
  return result;
}
export async function applicantLogin(request: Request) {
  try {
    assertApplicantOrigin(request);
    const clientKey = clientLimitKey(request);
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new ApplicantAuthError(401);
    let input: unknown;
    try { input = JSON.parse((await readBody(request, 2048)).toString("utf8")); }
    catch { throw new ApplicantAuthError(401); }
    const result = await authenticateApplicant(input, clientKey);
    const output = response({ authenticated: true });
    setSession(output, result.rawToken, result.session);
    return output;
  } catch (error) { return failure(error); }
}
export async function applicantSession(request: Request) {
  try {
    assertApplicantOrigin(request);
    const rawToken = applicantToken(request);
    const scope = await resolveApplicantSession(rawToken);
    const output = response({ authenticated: true });
    setSession(output, rawToken!, scope);
    return output;
  } catch (error) { return failure(error, true); }
}
export async function applicantLogout(request: Request) {
  try {
    assertApplicantOrigin(request);
    await logoutApplicantSession(applicantToken(request));
    const output = response({ authenticated: false });
    clear(output);
    return output;
  } catch (error) {
    // Retain the cookie on infrastructure failure so revocation can be retried;
    // never report a completed logout when the database has not confirmed it.
    return failure(error);
  }
}

import "server-only";
import { createHash } from "node:crypto";
import { isIP } from "node:net";

export const APPLICANT_COOKIE = "__Host-cruiseapply_applicant";
export class ApplicantAuthError extends Error {
  constructor(public status: number) { super("Applicant authentication request failed"); }
}
export function assertApplicantRollout() {
  if (process.env.APPLICANT_AUTH_ENABLED !== "true") throw new ApplicantAuthError(404);
}
export function assertApplicantOrigin(request: Request) {
  assertApplicantRollout();
  let origin: URL;
  try { origin = new URL(process.env.NEXT_PUBLIC_APP_URL ?? ""); }
  catch { throw new ApplicantAuthError(503); }
  if (origin.protocol !== "https:" || origin.username || origin.password) throw new ApplicantAuthError(503);
  if (request.headers.get("origin") !== origin.origin || request.headers.get("sec-fetch-site") === "cross-site") throw new ApplicantAuthError(403);
}
export const tokenDigest = (value: string) => createHash("sha256").update(value).digest("hex");
export function validToken(value: string) {
  return /^[A-Za-z0-9_-]{43}$/.test(value) && Buffer.from(value, "base64url").toString("base64url") === value;
}
export function cookieToken(request: Request, name: string) {
  const entries = (request.headers.get("cookie") ?? "").split(";").map(part => part.trim())
    .filter(part => part.slice(0, part.indexOf("=")) === name);
  if (entries.length !== 1) return null;
  const value = entries[0].slice(entries[0].indexOf("=") + 1);
  return validToken(value) ? value : null;
}
export const applicantToken = (request: Request) => cookieToken(request, APPLICANT_COOKIE);
export function clientLimitKey(request: Request) {
  // Only opt in after the deployment proxy strips/overwrites this header and
  // the origin cannot be reached around that proxy. Never trust X-Forwarded-For.
  const configured = process.env.APPLICANT_AUTH_TRUSTED_IP_HEADER;
  if (!configured) return "shared";
  if (!["cf-connecting-ip", "x-real-ip"].includes(configured)) throw new ApplicantAuthError(503);
  const address = request.headers.get(configured)?.trim();
  if (!address || !isIP(address)) throw new ApplicantAuthError(503);
  return tokenDigest(address);
}

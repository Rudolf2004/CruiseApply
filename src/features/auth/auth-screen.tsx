import { ShieldCheck } from "lucide-react";
import { PublicShell } from "@/components/public-shell";
import { Alert } from "@/components/ui";
import { AuthForm, type AuthMode } from "./auth-form";
const copy = {
  login: ["Staff Login", "Administrators and authorized staff sign in with email and password. Applicants use their voucher serial number and PIN."],
  "forgot-password": ["Let’s get you back in", "Enter your staff account email to request a password-reset link."],
  "reset-password": ["Choose a new password", "Secure your account with a new, unique password."]
};
export function AuthScreen({ mode, confirmationError = false }: { mode: AuthMode; confirmationError?: boolean }) {
  const [title,description] = copy[mode];
  return <PublicShell><main id="main" className="bg-slate-50 py-14 sm:py-20"><div className="container max-w-[520px]"><div className="card p-7 sm:p-10"><p className="eyebrow mb-3">CruiseApply staff access</p><h1 className="text-3xl font-bold tracking-tight">{title}</h1><p className="muted leading-6 mt-3 mb-8">{description}</p>{confirmationError && <div className="mb-5"><Alert error>This confirmation link is invalid or expired. Try signing in, or request a new password-reset link.</Alert></div>}<AuthForm mode={mode}/></div><p className="flex items-center justify-center gap-2 text-xs muted mt-6"><ShieldCheck size={16}/>Your information is protected with secure account access.</p></div></main></PublicShell>;
}

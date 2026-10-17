"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Alert, Button } from "@/components/ui";
import { sendJson } from "@/lib/client-api";
export type AuthMode = "login" | "forgot-password" | "reset-password";
export function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const [message,setMessage] = useState(""); const [error,setError] = useState("");
  const schema = z.object({ full_name: z.string().max(200), email: z.string().max(254), password: z.string().max(128) }).superRefine((values,ctx) => {
    if (mode !== "reset-password" && !z.email().safeParse(values.email).success) ctx.addIssue({ code:"custom",path:["email"],message:"Enter a valid email address." });
    if (mode !== "forgot-password" && values.password.length < (mode === "login" ? 1 : 12)) ctx.addIssue({code:"custom",path:["password"],message:mode === "login" ? "Enter your password." : "Use at least 12 characters."});
  });
  const { register,handleSubmit,formState:{errors,isSubmitting} } = useForm({ resolver:zodResolver(schema),defaultValues:{full_name:"",email:"",password:""} });
  const submit = handleSubmit(async values => {
    setError(""); setMessage("");
    try { const result = await sendJson<{message?:string;redirect?:string}>(`/api/auth/${mode}`,values); if (result.redirect) { router.replace(result.redirect); router.refresh(); } else setMessage(result.message ?? "Done."); }
    catch (error) { setError(error instanceof Error ? error.message : "Please try again."); }
  });
  return <form onSubmit={submit} className="grid gap-5" noValidate>
    {message && <Alert>{message}</Alert>}{error && <Alert error>{error}</Alert>}
    {mode !== "reset-password" && <label className="field">Email address<input {...register("email")} type="email" autoComplete="email" aria-invalid={Boolean(errors.email)}/>{errors.email && <span className="text-red-700 text-xs">{errors.email.message}</span>}</label>}
    {mode !== "forgot-password" && <label className="field">{mode === "reset-password" ? "New password" : "Password"}<input {...register("password")} type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} aria-invalid={Boolean(errors.password)}/>{errors.password && <span className="text-red-700 text-xs">{errors.password.message}</span>}{mode !== "login" && <span className="muted text-xs font-normal">Use a unique password with at least 12 characters.</span>}</label>}
    {mode === "login" && <Link href="/forgot-password" className="text-primary text-sm text-right">Forgot password?</Link>}
    <Button disabled={isSubmitting}>{isSubmitting ? "Please wait…" : mode === "login" ? "Sign In" : mode === "forgot-password" ? "Send Reset Link" : "Update Password"}</Button>
    <p className="text-center text-sm"><Link href="/applicant/login" className="text-primary">Applicant Login — Serial Number + PIN</Link></p>
  </form>;
}

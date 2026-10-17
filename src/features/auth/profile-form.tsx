"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Alert, Button } from "@/components/ui";
import { sendJson } from "@/lib/client-api";
export function ProfileForm({ fullName, phone, email }: { fullName: string; phone: string; email: string }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const { register, handleSubmit, formState: { isSubmitting, errors } } = useForm({ defaultValues: { full_name: fullName, phone } });
  return <form className="grid gap-5 max-w-xl" onSubmit={handleSubmit(async values => {
    setError(""); setMessage("");
    try { await sendJson("/api/profile", values, "PATCH"); setMessage("Your profile has been saved."); }
    catch (error) { setError(error instanceof Error ? error.message : "Please try again."); }
  })}>
    {message && <Alert>{message}</Alert>}{error && <Alert error>{error}</Alert>}
    <label className="field">Full name<input {...register("full_name", { required: true, minLength: 2, maxLength: 200 })} autoComplete="name"/>{errors.full_name && <span className="text-red-700 text-xs">Enter your full name.</span>}</label>
    <label className="field">Phone<input {...register("phone", { maxLength: 30 })} autoComplete="tel" type="tel"/></label>
    <label className="field">Account email<input value={email} readOnly/><span className="text-xs muted font-normal">Your email identifies your account and payment receipts.</span></label>
    <Button disabled={isSubmitting}>{isSubmitting ? "Saving…" : "Save profile"}</Button>
  </form>;
}

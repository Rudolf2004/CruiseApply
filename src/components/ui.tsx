import Link from "next/link";
import { ArrowRight, CircleAlert, Inbox, LoaderCircle } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
export function Button({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`button ${className}`} {...props}/>;
}
export function ButtonLink({ href, children, secondary = false }: { href: string; children: ReactNode; secondary?: boolean }) {
  return <Link className={`button${secondary ? " secondary" : ""}`} href={href}>{children}</Link>;
}
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>;
}
export function PageHeader({ eyebrow, title, description, children }: { eyebrow?: string; title: string; description?: string; children?: ReactNode }) {
  return <div className="flex flex-wrap items-end justify-between gap-6 mb-8"><div>{eyebrow && <p className="eyebrow mb-3">{eyebrow}</p>}<h1 className="text-3xl sm:text-4xl font-bold tracking-tight">{title}</h1>{description && <p className="muted mt-3 max-w-2xl leading-relaxed">{description}</p>}</div>{children}</div>;
}
export function Alert({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div role={error ? "alert" : "status"} className={`flex gap-3 p-4 rounded-xl text-sm ${error ? "bg-red-50 text-red-800" : "bg-blue-50 text-blue-900"}`}><CircleAlert size={20} className="shrink-0"/><div>{children}</div></div>;
}
export function EmptyState({ title, description, href, action }: { title: string; description: string; href?: string; action?: string }) {
  return <Card className="text-center py-14"><Inbox className="mx-auto text-muted mb-5" size={36}/><h2 className="text-xl font-semibold">{title}</h2><p className="muted mt-3 mb-6 max-w-md mx-auto">{description}</p>{href && <ButtonLink href={href}>{action ?? "Continue"}<ArrowRight size={16}/></ButtonLink>}</Card>;
}
export function StatusBadge({ status }: { status: string }) {
  const color = ["accepted", "successful", "published", "unused"].includes(status) ? "bg-emerald-50 text-emerald-800" : ["unsuccessful", "failed", "cancelled", "expired"].includes(status) ? "bg-red-50 text-red-800" : "bg-blue-50 text-blue-800";
  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold capitalize ${color}`}>{status.replaceAll("_", " ")}</span>;
}
export function LoadingState() { return <div className="container py-20" role="status"><LoaderCircle className="animate-spin text-primary mb-4"/><span className="muted">Loading your next opportunity…</span><div className="grid sm:grid-cols-3 gap-5 mt-8" aria-hidden="true">{[1,2,3].map(n => <div key={n} className="h-44 rounded-2xl bg-slate-100 animate-pulse"/>)}</div></div>; }

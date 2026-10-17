"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Bell, CreditCard, FileText, FolderOpen, LayoutDashboard, LogOut, Search, Settings, Ticket, UserRound, type LucideIcon } from "lucide-react";
import { sendJson } from "@/lib/client-api";
const applicantLinks: [string,string,LucideIcon][] = [["/dashboard","Overview",LayoutDashboard],["/dashboard/applications","My Applications",FileText],["/jobs","Browse Jobs",Search],["/dashboard/vouchers","Vouchers",Ticket],["/dashboard/payments","Payments",CreditCard],["/dashboard/documents","Documents",FolderOpen],["/dashboard/notifications","Notifications",Bell],["/dashboard/profile","Profile",UserRound],["/dashboard/settings","Settings",Settings]];
export function DashboardNavigation({admin = false}:{admin?:boolean}) {
  const path = usePathname(); const router = useRouter(); const [error,setError] = useState(""); const [busy,setBusy] = useState(false);
  const links: [string,string,LucideIcon][] = admin ? [["/admin","Admin overview",LayoutDashboard],["/admin/applications","Candidate screening",FileText],["/admin/employers","Employers & opportunities",Search],["/admin/records/payments","Records & exports",CreditCard],["/admin/records/audit","Audit log",FileText],["/admin/reports","Reports",LayoutDashboard],["/admin/pricing/contact/support_email","Public support contact",Settings],["/dashboard","My account",UserRound]] : applicantLinks;
  return <nav aria-label={admin?"Administration":"Applicant navigation"} className="grid gap-1">{links.map(([href,label,Icon])=><Link key={href} href={href} aria-current={path===href?"page":undefined} className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium ${path===href?"bg-blue-50 text-primary":"text-slate-600 hover:bg-slate-50"}`}><Icon size={19}/>{label}</Link>)}<button disabled={busy} onClick={async()=>{setBusy(true);setError("");try{await sendJson("/api/auth/logout",{});router.replace("/login");router.refresh();}catch{setError("Could not sign out. Please try again.");setBusy(false);}}} className="flex items-center gap-3 rounded-lg px-4 py-3 text-sm text-slate-600 mt-5 text-left"><LogOut size={19}/>{busy?"Signing out…":"Sign Out"}</button>{error&&<p role="alert" className="text-red-700 text-xs px-4">{error}</p>}</nav>;
}

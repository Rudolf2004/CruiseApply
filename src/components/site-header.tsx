"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, Search, Waves, X } from "lucide-react";
const links = [["/", "Home"], ["/jobs", "Jobs"], ["/how-it-works", "How It Works"], ["/about", "About"], ["/contact", "Contact"]];
export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(false);
  return <header className="bg-white border-b border-slate-100 relative z-20">
    <div className="container flex items-center justify-between gap-2 sm:gap-6 h-[84px]">
      <Link href="/" aria-label="CruiseApply home" className="flex items-center gap-2 text-[22px] sm:text-[30px] font-bold tracking-tight"><Waves className="text-primary w-7 sm:w-[38px]" size={38} strokeWidth={3}/><span>Cruise<span className="text-primary">Apply</span></span></Link>
      <nav aria-label="Main navigation" className="hidden lg:flex items-center gap-9 h-full">{links.map(([href, label]) => <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} className={`relative flex h-full items-center text-base ${pathname === href ? "after:absolute after:bottom-3 after:h-0.5 after:w-full after:bg-primary" : "text-slate-600 hover:text-primary"}`}>{label}</Link>)}</nav>
      <div className="flex items-center gap-1 sm:gap-4"><button type="button" aria-label={search ? "Close search" : "Search jobs"} aria-expanded={search} onClick={() => setSearch(!search)} className="p-2">{search ? <X size={23}/> : <Search size={23}/>}</button><Link className="button secondary hidden md:inline-flex" href="/applicant/login">Applicant Login</Link><Link className="button hidden sm:inline-flex" href="/buy-voucher">Buy Voucher</Link><button className="lg:hidden p-2" aria-expanded={open} aria-controls="mobile-nav" aria-label="Toggle navigation" onClick={() => setOpen(!open)}>{open ? <X/> : <Menu/>}</button></div>
    </div>
    {search && <form action="/jobs" className="container pb-5 flex gap-3"><label className="field flex-1"><span className="sr-only">Search job titles, companies or keywords</span><input name="q" placeholder="Search job titles, companies or keywords" autoFocus maxLength={100}/></label><button className="button">Search jobs</button></form>}
    {open && <nav id="mobile-nav" aria-label="Mobile navigation" className="lg:hidden container pb-6 grid gap-1">{links.map(([href, label]) => <Link href={href} key={href} className="py-3" onClick={() => setOpen(false)}>{label}</Link>)}<Link href="/applicant/login" className="py-3">Applicant Login</Link><Link href="/buy-voucher" className="button">Buy Voucher</Link></nav>}
  </header>;
}

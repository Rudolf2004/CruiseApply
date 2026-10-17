import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { ButtonLink,Card,EmptyState,PageHeader,StatusBadge } from "@/components/ui";
import { notificationHref } from "@/features/notifications/links";
import { applicationGuidance } from "@/features/applications/tracking";
export default async function Dashboard() {
  const { db,user,profile } = await requireUser();
  const [applications,vouchers,notifications,unread] = await Promise.all([
    db.from("applications").select("id,reference,status,updated_at,opportunity_title_snapshot",{ count: "exact" }).eq("user_id",user.id).order("updated_at",{ ascending: false }).limit(5),
    db.from("vouchers").select("id",{ count: "exact",head: true }).eq("user_id",user.id).eq("status","unused").gt("expires_at",new Date().toISOString()),
    db.from("notifications").select("id,title,body,href,read_at,created_at").eq("user_id",user.id).order("created_at",{ ascending: false }).limit(4),
    db.from("notifications").select("id",{ count: "exact",head: true }).eq("user_id",user.id).is("read_at",null),
  ]);
  if (applications.error || vouchers.error || notifications.error || unread.error) throw new Error("Your dashboard could not be loaded.");
  return <><PageHeader eyebrow="Your career journey" title={`Welcome, ${profile.full_name.split(" ")[0] || "applicant"}`} description="Your applications, updates, and next steps in one place."><ButtonLink href="/jobs">Explore opportunities</ButtonLink></PageHeader>
    <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-5 mb-9">{[["Applications",applications.count ?? 0,"/dashboard/applications"],["Available vouchers",vouchers.count ?? 0,"/dashboard/vouchers"],["Unread updates",unread.count ?? 0,"/dashboard/notifications?filter=unread"],["Profile essentials",`${[profile.full_name,profile.phone,user.email].filter(Boolean).length}/3`,"/dashboard/profile"]].map(([label,value,href]) => <Card key={String(label)}><Link href={String(href)} className="text-primary underline text-sm">{label}</Link><p className="text-3xl font-bold mt-3">{value}</p></Card>)}</div>
    <div className="grid xl:grid-cols-[1.4fr_1fr] gap-7"><section><h2 className="text-xl font-bold mb-5">Recent applications</h2>{applications.data.length ? <div className="grid gap-4">{applications.data.map(application => <Card key={application.id}><div className="flex flex-wrap gap-3 items-center justify-between"><Link className="font-semibold text-primary underline" href={`/dashboard/applications/${application.id}`}>{application.reference}</Link><StatusBadge status={application.status}/></div><p className="mt-3 font-medium">{application.opportunity_title_snapshot}</p><p className="muted text-sm mt-3">{applicationGuidance(application.status)}</p><p className="muted text-xs mt-3">Updated {new Date(application.updated_at).toLocaleString("en-GB")}</p></Card>)}</div> : <EmptyState title="Your journey is just beginning" description="Find a suitable CruiseApply opportunity, review its service scope, and activate your application with a voucher." href="/jobs" action="Browse opportunities"/>}</section>
    <section><div className="flex flex-wrap justify-between gap-3 mb-5"><h2 className="text-xl font-bold">Latest updates</h2><Link className="text-primary underline" href="/dashboard/notifications">View all updates</Link></div>{notifications.data.length ? <div className="grid gap-4">{notifications.data.map(item => { const href = notificationHref(item.href); return <Card key={item.id}><h3 className="font-semibold">{item.title}</h3>{!item.read_at && <span className="text-xs text-primary">Unread</span>}<p className="muted text-sm leading-6 mt-2">{item.body}</p><p className="muted text-xs my-3">{new Date(item.created_at).toLocaleString("en-GB")}</p>{href && <Link className="text-primary underline" href={href}>View details</Link>}</Card>; })}</div> : <EmptyState title="No updates yet" description="Application and payment updates will appear here."/>}</section></div>
  </>;
}

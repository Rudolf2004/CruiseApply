import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { ButtonLink,Card,EmptyState,PageHeader } from "@/components/ui";
import { notificationHref } from "@/features/notifications/links";
import { ReadNotificationButton } from "@/features/notifications/read-button";
export default async function Notifications({ searchParams }: { searchParams: Promise<{ page?: string; filter?: string }> }) {
  const { db,user } = await requireUser(); const params = await searchParams;
  const unreadOnly = params.filter === "unread"; const page = Math.floor(Math.max(1,Math.min(10000,Number(params.page) || 1))); const from = (page-1)*20;
  let query = db.from("notifications").select("id,title,body,href,read_at,created_at",{ count: "exact" }).eq("user_id",user.id);
  if (unreadOnly) query = query.is("read_at",null);
  const [records,unread] = await Promise.all([
    query.order("created_at",{ ascending: false }).order("id").range(from,from+19),
    db.from("notifications").select("id",{ count: "exact",head: true }).eq("user_id",user.id).is("read_at",null),
  ]);
  if (records.error || unread.error) throw new Error("Notifications unavailable.");
  const suffix = unreadOnly ? "&filter=unread" : "";
  return <><PageHeader title="Notifications" description={`${unread.count ?? 0} unread updates about your account and applications.`}/>
    <nav aria-label="Notification filters" className="flex gap-4 mb-6"><Link aria-current={!unreadOnly ? "page" : undefined} className="text-primary underline" href="/dashboard/notifications">All updates</Link><Link aria-current={unreadOnly ? "page" : undefined} className="text-primary underline" href="?filter=unread">Unread</Link></nav>
    <div className="grid gap-4">{records.data.map(item => { const href = notificationHref(item.href); return <Card key={item.id}>
      <div className="flex flex-wrap justify-between gap-3"><h2 className="font-semibold">{item.title}</h2><span className="text-sm">{item.read_at ? "Read" : "Unread"}</span></div>
      <p className="muted mt-3 leading-6">{item.body}</p><p className="muted text-xs my-3">{new Date(item.created_at).toLocaleString("en-GB")}</p>
      <div className="flex flex-wrap gap-3 items-center">{href && <ButtonLink secondary href={href}>View details</ButtonLink>}{!item.read_at && <ReadNotificationButton id={item.id}/>}</div>
    </Card>; })}</div>
    {!records.data.length && <EmptyState title={unreadOnly ? "No unread updates" : "No updates yet"} description="Payment and application updates will appear here."/>}
    <nav aria-label="Notification pages" className="flex gap-3 mt-6">{page>1 && <ButtonLink secondary href={`?page=${page-1}${suffix}`}>Previous</ButtonLink>}{from+20<(records.count ?? 0) && <ButtonLink secondary href={`?page=${page+1}${suffix}`}>Next</ButtonLink>}</nav>
  </>;
}

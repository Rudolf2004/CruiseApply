import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { ButtonLink, Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { ProfileForm } from "@/features/auth/profile-form";
const titles:Record<string,string>={applications:"My Applications",vouchers:"My Vouchers",payments:"Payment History",documents:"My Documents",notifications:"Notifications",profile:"My Profile",settings:"Account Settings"};
export default async function DashboardSection({params}:{params:Promise<{section:string}>}) {
  const {section}=await params; if(!titles[section])notFound();
  const {db,user,profile}=await requireUser();
  if(section==="profile")return <><PageHeader title={titles[section]} description="Keep your contact information up to date."/><Card><ProfileForm fullName={profile.full_name} phone={profile.phone??""} email={user.email??""}/></Card></>;
  if(section==="settings")return <><PageHeader title={titles[section]} description="Manage your account security."/><Card><h2 className="text-xl font-bold mb-3">Password & security</h2><p className="muted mb-6">Use a unique password to protect your application and documents.</p><ButtonLink href="/reset-password">Change password</ButtonLink></Card></>;
  const sources:Record<string,{table:string;columns:string}>={
    applications:{table:"applications",columns:"id,reference,status,created_at,updated_at"},
    vouchers:{table:"vouchers",columns:"id,serial,status,purchased_at,expires_at"},
    payments:{table:"payments",columns:"id,reference,amount,currency,status,created_at"},
    documents:{table:"application_documents",columns:"id,name,kind,size_bytes,created_at"},
    notifications:{table:"notifications",columns:"id,title,body,created_at"}
  };
  const source=sources[section];
  const {data,error}=await db.from(source.table).select(source.columns).eq("user_id",user.id).order(section==="vouchers"?"purchased_at":"created_at",{ascending:false}).limit(100);
  if(error)throw new Error("This account information is temporarily unavailable.");
  const rows=data as unknown as {id:string;reference?:string;serial?:string;status?:string;title?:string;name?:string;body?:string;amount?:number;currency?:string;created_at?:string;purchased_at?:string;expires_at?:string;kind?:string;size_bytes?:number}[];
  return <><PageHeader title={titles[section]} description="Your most recent records, visible only to your account and authorized staff."/>{rows.length?<div className="grid gap-4">{rows.map(row=><Card key={row.id}><div className="flex items-center justify-between flex-wrap gap-3"><h2 className="font-semibold">{row.reference??row.serial??row.title??row.name}</h2>{row.status&&<StatusBadge status={row.status}/>}</div>{row.body&&<p className="muted text-sm mt-3 leading-6">{row.body}</p>}{row.amount!==undefined&&<p className="font-semibold mt-3">{new Intl.NumberFormat("en",{style:"currency",currency:row.currency??"GHS"}).format(row.amount/100)}</p>}<p className="muted text-xs mt-3">{new Date(row.created_at??row.purchased_at??"").toLocaleDateString("en-GB")}{row.expires_at&&` · Expires ${new Date(row.expires_at).toLocaleDateString("en-GB")}`}{row.kind&&` · ${row.kind}`}</p></Card>)}</div>:<EmptyState title={`No ${section} yet`} description={section==="notifications"?"New updates will appear here when there’s news about your account or application.":"Your records will appear here as you progress through your application journey."}/>}</>;
}

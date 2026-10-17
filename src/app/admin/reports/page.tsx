import Link from "next/link";
import {Users,FileText,Clock,CheckCircle2,XCircle,Undo2,CreditCard,Ticket,ArrowRight,Download,ClipboardCheck,MessageSquare, type LucideIcon} from "lucide-react";
import {requireUser} from "@/lib/auth";
import {applicationStatuses} from "@/features/applications/tracking";

const icons:Record<string,LucideIcon>={submitted:FileText,under_review:Clock,accepted:CheckCircle2,unsuccessful:XCircle,withdrawn:Undo2,interview:Users,successful:CheckCircle2,pending:Clock,failed:XCircle,refunded:Undo2,used:ArrowRight,expired:Clock,cancelled:XCircle,shortlisted:ClipboardCheck,additional_information_required:MessageSquare};
function title(status:string){return status==="accepted"?"Accepted (screening)":status==="used"?"Redeemed":status.replaceAll("_"," ").replace(/^./,c=>c.toUpperCase());}
export default async function Reports(){
 const {db}=await requireUser(true);
 const definitions=[...applicationStatuses.map(status=>({table:"applications",status})),...["pending","successful","failed","refunded"].map(status=>({table:"payments",status})),...["unused","used","expired","cancelled","refunded"].map(status=>({table:"vouchers",status}))];
 const counts=await Promise.all(definitions.map(d=>db.from(d.table).select("id",{count:"exact",head:true}).eq("status",d.status)));
 if(counts.some(r=>r.error))throw new Error("Reports unavailable.");
 return <section className="staff-report-page"><header className="staff-page-heading"><h1>Operational reports</h1><p>View key platform metrics and browse records for internal reporting.</p><p>Counts reflect current system data. Screening acceptance is not an employer job offer.</p></header>
 {["applications","payments","vouchers"].map(table=>{
 const entries=definitions.flatMap((d,i)=>d.table===table?[{status:d.status,count:counts[i].count??0}]:[]);
 const TotalIcon=table==="applications"?Users:table==="payments"?CreditCard:Ticket;
 return <section className="report-section" key={table}><h2>{table.replace(/^./,c=>c.toUpperCase())}</h2><div className="report-metrics">
 <div className="report-metric"><span className="report-icon"><TotalIcon size={26}/></span><div><p>{table==="vouchers"?"Total issued":"Total "+table}</p><strong>{entries.reduce((sum,e)=>sum+e.count,0).toLocaleString("en-GB")}</strong></div></div>
 {entries.map(entry=>{const Icon=icons[entry.status]??FileText;const tone=["unsuccessful","failed","withdrawn","cancelled","refunded"].includes(entry.status)?"red":["successful","accepted","unused"].includes(entry.status)?"green":entry.status==="pending"?"amber":entry.status==="interview"?"purple":entry.status==="expired"?"gray":"blue";return <div className="report-metric" key={entry.status}><span className={"report-icon tone-"+tone}><Icon size={26}/></span><div><p>{title(entry.status)}</p><strong>{entry.count.toLocaleString("en-GB")}</strong></div></div>;})}
 </div></section>;})}
 <Link className="staff-primary-action" href="/admin/records/payments"><Download size={19}/>Browse records &amp; CSV exports</Link>
 <p className="report-footnote">Counts are not financial settlement totals and may change between queries. Unused vouchers may include vouchers past their redemption deadline.</p>
 </section>;
}

import Image from "next/image";
import Link from "next/link";
import {ArrowRight,CheckCircle2,FileText,Globe2,Headphones,ShieldCheck,Ticket,UsersRound,Utensils,Wrench,Heart,ShoppingCart,Music,MoreHorizontal,Search,PlayCircle,Clock} from "lucide-react";
import {PublicShell} from "@/components/public-shell";
import {ButtonLink,EmptyState} from "@/components/ui";
import {JobCard} from "@/features/jobs/job-card";
import {listJobs} from "@/features/jobs/repository";
export const dynamic="force-dynamic";
const features=[
 {icon:Globe2,title:"Managed Opportunities",copy:"Explore published intake categories and requirements"},
 {icon:FileText,title:"Simple Application Process",copy:"Purchase a voucher and apply online"},
 {icon:ShieldCheck,title:"Global Careers",copy:"Explore your next step in the cruise industry"},
 {icon:Headphones,title:"Support & Guidance",copy:"Get help throughout your application journey"}
];
const steps=[
 {icon:Search,title:"Find your opportunity",copy:"Explore available intake categories and understand the requirements before you apply."},
 {icon:Ticket,title:"Buy a voucher",copy:"Purchase CruiseApply Application Access to receive your unique Serial Number and PIN. Review current pricing at checkout."},
 {icon:FileText,title:"Apply with your voucher",copy:"Use your Serial Number and PIN to complete your application and submit your documents securely."},
 {icon:CheckCircle2,title:"Track your progress",copy:"Return with the same credentials to see updates and respond to requests from our team."}
];
const departments=[
 {icon:UsersRound,title:"Hospitality & Guest Services",query:"Guest Services",copy:"Front office, housekeeping, guest relations and more."},
 {icon:Utensils,title:"Food & Beverage",query:"Food & Beverage",copy:"Culinary, restaurant, bar and catering roles."},
 {icon:Wrench,title:"Technical Operations",query:"Technical Operations",copy:"Engineering, maintenance and technical support."},
 {icon:ShieldCheck,title:"Security & Safety",query:"Security",copy:"Safety, security and compliance roles."},
 {icon:Music,title:"Entertainment",query:"Entertainment",copy:"Live entertainment, recreation and activities."},
 {icon:Heart,title:"Health & Wellness",query:"Health",copy:"Medical, wellness and fitness roles."},
 {icon:ShoppingCart,title:"Retail & Procurement",query:"Retail",copy:"Retail operations and supply chain support."},
 {icon:MoreHorizontal,title:"Other Opportunities",query:"",copy:"Explore other roles across departments."}
];
const questions=[
 ["Is CruiseApply a cruise line or an official recruitment agent?","No. CruiseApply independently manages candidate intake, application screening and potential employer matching. We do not claim an official affiliation with any cruise line."],
 ["Does buying a voucher guarantee a job?","No. Payment covers the described CruiseApply application and screening service. It does not guarantee an interview, referral, placement, visa or employment. Employers make final hiring decisions."],
 ["Can I save my application and return later?","Yes. Save your application as a draft and return using your voucher Serial Number and PIN before submitting."],
 ["How will I track my application?","Use Applicant Login with your Serial Number and PIN to see your status, notifications and requests for additional information."]
];
export default async function Home(){
 const {jobs,demo}=await listJobs({featured:true});
 return <PublicShell><main id="main" className="marketing-home">
 <section className="marketing-hero">
 <Image src="/cruise-hero.png" alt="An unbranded cruise ship at sea" fill priority sizes="100vw" className="marketing-hero-image"/>
 <div className="marketing-hero-shade"/>
 <div className="container marketing-hero-content"><p className="eyebrow">Global opportunities at sea</p><h1>Your Career.<br/><span>Beyond Borders.</span></h1><p className="marketing-intro">Explore cruise career opportunities, apply with confidence, and take the next step in your global career journey.</p><div className="marketing-actions"><ButtonLink href="/jobs">Explore Opportunities<ArrowRight size={18}/></ButtonLink><ButtonLink href="/how-it-works" secondary><PlayCircle size={21}/>How It Works</ButtonLink></div></div>
 </section>
 <section className="marketing-path"><div className="container">
 <div className="marketing-benefits" aria-label="Why apply with CruiseApply">{features.map(({icon:Icon,title,copy})=><div key={title}><span className="marketing-icon"><Icon size={27}/></span><div><h2>{title}</h2><p>{copy}</p></div></div>)}</div>
 <header className="marketing-section-heading centered"><p className="eyebrow">A clear path forward</p><h2>How CruiseApply Works</h2><p>From discovering a role to tracking your application, take each step with clarity.</p></header>
 <div className="marketing-steps">{steps.map(({icon:Icon,title,copy},i)=><article key={title}><div className="marketing-step-top"><span className="marketing-icon"><Icon size={28}/></span><span className="marketing-step-number">0{i+1}</span></div><h3>{title}</h3><p>{copy}</p></article>)}</div>
 </div></section>
 <section className="marketing-featured container"><header className="marketing-section-heading split"><div><p className="eyebrow">Latest opportunities</p><h2>Featured Cruise Opportunities</h2></div><Link href="/jobs">View All Opportunities<ArrowRight size={17}/></Link></header>
 {demo&&<p className="muted mb-4">Development preview — sample categories, not live openings.</p>}
 {jobs.length?<div className="marketing-jobs">{jobs.slice(0,3).map(job=><JobCard key={job.id} job={job}/>)}</div>:<EmptyState title="Your next opportunity is on the horizon" description="Published CruiseApply intake categories will appear here. Learn about our screening process while you wait." href="/how-it-works" action="See how it works"/>}
 </section>
 <section className="marketing-departments"><div className="container"><header className="marketing-section-heading split"><div><p className="eyebrow">Explore career areas</p><h2>Find the department for you</h2><p>Cruise operations bring together a wide range of professions. Explore where your experience could take you.</p></div><Link href="/jobs">Explore All Departments<ArrowRight size={17}/></Link></header><div className="marketing-department-grid">{departments.map(({icon:Icon,title,query,copy})=><Link key={title} href={query?"/jobs?q="+encodeURIComponent(query):"/jobs"}><span className="marketing-icon"><Icon size={27}/></span><div><h3>{title}</h3><p>{copy}</p></div><ArrowRight className="department-arrow" size={18}/></Link>)}</div></div></section>
 <section className="container marketing-faq"><header className="marketing-section-heading"><p className="eyebrow">Good to know</p><h2>Questions before<br/>you set sail?</h2><p>Get answers to common questions about our process, vouchers and applications.</p><Link href="/contact">Contact our team<ArrowRight size={18}/></Link></header><div>{questions.map(([question,answer])=><details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div></section>
 <section className="container marketing-cta-wrap"><div className="marketing-cta"><Image src="/cruise-hero.png" alt="" fill sizes="100vw" className="marketing-cta-image"/><div className="marketing-cta-shade"/><div className="marketing-cta-copy"><p className="eyebrow">Ready for your next chapter?</p><h2>Explore Global Opportunities</h2><p>Start your application for CruiseApply candidate screening and potential employer matching.</p><ButtonLink href="/buy-voucher" secondary>Buy Voucher Now<ArrowRight size={18}/></ButtonLink></div><ul><li><CheckCircle2 size={22}/>Application access and screening</li><li><Clock size={22}/>Review price and validity at checkout</li><li><FileText size={22}/>Use Serial Number and PIN to apply</li></ul></div></section>
 </main></PublicShell>;
}

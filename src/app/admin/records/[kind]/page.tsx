import Link from "next/link";
import {notFound} from "next/navigation";
import {Download,Search,ArrowLeft,ArrowRight,Plus,Inbox} from "lucide-react";
import {requireUser} from "@/lib/auth";
import {records,recordKind} from "@/features/admin-records/catalog";
import {loadRecords} from "@/features/admin-records/service";
function label(value:string){return value.replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());}
function display(value:unknown,column:string){
 if(value==null)return <span className="records-null">—</span>;
 if(column==='status')return <span className={'records-status records-status-'+String(value)}>{label(String(value))}</span>;
 if(typeof value==='boolean')return value?'Yes':'No';
 if(column.endsWith('_at')||['as_of','valid_until'].includes(column)){
  const date=new Date(String(value));if(!Number.isNaN(date.getTime()))return <time dateTime={date.toISOString()}>{date.toLocaleDateString('en-GB',{year:'numeric',month:'short',day:'numeric',timeZone:'UTC'})}<small className="records-time">{date.toLocaleTimeString('en-GB',{hour12:false,timeZone:'UTC'})} UTC</small></time>;
 }
 return String(value);
}
export default async function Records({params,searchParams}:{params:Promise<{kind:string}>;searchParams:Promise<Record<string,string|undefined>>}){
 const {db,profile}=await requireUser(true),kind=recordKind((await params).kind);if(!kind)notFound();const config=records[kind],data=await loadRecords(db,kind,await searchParams);
 const link=(page:number)=>'?'+new URLSearchParams({page:String(page),q:data.filters.q,status:data.filters.status});
 const editor={regions:'region',overrides:'override',countries:'country',exchange:'exchange'} as Record<string,string>;
 const create=kind==='opportunities'?{href:'/admin/configuration/intake/new',label:'Create managed intake'}:profile.role==='super_admin'&&['regions','exchange','overrides'].includes(kind)?{href:'/admin/pricing/'+editor[kind]+'/new',label:'Add reviewed configuration'}:null;
 return <section className="records-page"><header className="records-heading"><div><h1>{config.title}</h1><p>{config.description}</p></div>{create&&<Link href={create.href} className="records-create"><Plus size={17}/>{create.label}</Link>}</header>
 <nav aria-label="Administrative records" className="records-tabs">{Object.entries(records).map(([key,value])=><Link key={key} href={'/admin/records/'+key} aria-current={key===kind?'page':undefined}>{value.title}</Link>)}</nav>
 <form method="get" className="records-filters"><label>Search {config.search.replaceAll('_',' ')}<span className="records-search-field"><Search size={17}/><input name="q" defaultValue={data.filters.q} maxLength={80} placeholder={kind==='payments'?'e.g. CA-xxxx':kind==='vouchers'?'e.g. CRV-2026-…':`Search ${config.search.replaceAll('_',' ')}…`}/></span></label>{config.statuses.length>0&&<label>Status<select name="status" defaultValue={data.filters.status}><option value="">All statuses</option>{config.statuses.map(status=><option key={status} value={status}>{label(status)}</option>)}</select></label>}<button className="records-search-button" type="submit">Search</button>{(data.filters.q||data.filters.status)&&<Link className="records-clear" href={'/admin/records/'+kind}>Clear filters</Link>}</form>
 <div className="records-summary"><p>{data.count.toLocaleString('en-GB')} matching {data.count===1?'record':'records'}. <span>Page {data.filters.page}.</span></p><span className="records-scroll-hint">Scroll table to view all columns</span></div>
 <div className="records-card"><div className="records-table-scroll" tabIndex={0} role="region" aria-label={config.title+' table, scroll horizontally for more columns'}><table className="records-table"><caption className="sr-only">{config.title}. Dates are shown in UTC. Amounts remain in the smallest currency unit.</caption><thead><tr>{config.columns.map(column=><th key={column} scope="col">{label(column)}</th>)}</tr></thead><tbody>{data.rows.map((row,i)=><tr key={String(row[config.columns[0]]??i)}>{config.columns.map(column=><td key={column} className={['reference','id','target_id','actor_id','actor_applicant_id','voucher_type_id','region_id'].includes(column)?'records-identifier':column==='amount'||column==='charge_amount'?'records-number':undefined}>{column==='id'&&['opportunities','pricing'].includes(kind)?<Link className="records-record-link" href={'/admin/configuration/'+(kind==='pricing'?'product':'intake')+'/'+row[column]}>Open configuration<ArrowRight size={13}/></Link>:(column==='id'&&['regions','overrides'].includes(kind)||column==='code'&&kind==='countries'||column==='quote_currency'&&kind==='exchange')&&profile.role==='super_admin'?<Link className="records-record-link" href={'/admin/pricing/'+editor[kind]+'/'+row[column]}>{String(row[column])}</Link>:display(row[column],column)}</td>)}</tr>)}</tbody></table></div>
 {!data.rows.length&&<div className="records-empty"><Inbox size={32}/><h2>No matching records</h2><p>Try a different search or status.</p>{(data.filters.q||data.filters.status)&&<Link href={'/admin/records/'+kind}>Clear filters</Link>}</div>}
 <footer className="records-table-footer"><a className="records-download" href={'/api/admin/records/'+kind+'/export'+link(data.filters.page)}><Download size={20}/><span>Download this page as CSV <small>(up to 25 records)</small></span></a>{(data.filters.page>1||data.filters.page*data.size<data.count)&&<nav aria-label="Record pages" className="records-pagination">{data.filters.page>1&&<Link href={link(data.filters.page-1)}><ArrowLeft size={15}/>Previous</Link>}{data.filters.page*data.size<data.count&&<Link href={link(data.filters.page+1)}>Next<ArrowRight size={15}/></Link>}</nav>}</footer></div></section>;
}

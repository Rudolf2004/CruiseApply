import "server-only";
import {staffPricingReader} from "./pricing-reader";
import type {SupabaseClient} from "@supabase/supabase-js";
import {records,type RecordKind,recordFilters} from "./catalog";
export async function loadRecords(db:SupabaseClient,kind:RecordKind,params:Record<string,string|undefined>){
 const config=records[kind],filters=recordFilters(params),size=25;
 const reader=["regions","countries","exchange","overrides"].includes(kind)?await staffPricingReader(db):db;
 let query=reader.from(config.table).select(config.columns.join(","),{count:"exact"});
 if(filters.q)query=query.ilike(config.search,"%"+filters.q+"%");
 if((config.statuses as readonly string[]).includes(filters.status))query=query.eq("status",filters.status);
 const result=await query.order(config.order,{ascending:false}).order(config.columns[0]).range((filters.page-1)*size,filters.page*size-1);
 if(result.error)throw new Error("Administrative records are unavailable.");
 return {rows:result.data as unknown as Record<string,unknown>[],count:result.count??0,filters,size};
}

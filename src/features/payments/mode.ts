import {ApiError} from "@/lib/http";
export function assertPaymentMode(key:string){
 const mode=process.env.PAYSTACK_MODE??"test";
 if(!["test","live"].includes(mode)||!key.startsWith(`sk_${mode}_`))throw new ApiError(503,"Payment configuration is unavailable.");
 if(mode==="live"){
  let origin:URL;try{origin=new URL(process.env.NEXT_PUBLIC_APP_URL??"");}catch{throw new ApiError(503,"Live payment origin is unavailable.");}
  if(process.env.PAYSTACK_LIVE_ENABLED!=="true"||origin.protocol!=="https:"||origin.hostname==="localhost"||origin.hostname==="127.0.0.1"||origin.hostname==="[::1]")throw new ApiError(503,"Live payments are not enabled.");
 }
}

import {z} from "zod";
import {questionSchema,documentKind} from "@/features/applications/schema";
const base={id:z.uuid(),revision:z.number().int().min(0).max(2147483646)};
export const adminCommand=z.discriminatedUnion("operation",[
 z.object({requestId:z.uuid(),operation:z.literal("product_save"),data:z.object({...base,name:z.string().trim().min(2).max(200),description:z.string().trim().min(10).max(5000),amount:z.number().int().min(1).max(999999999),validityDays:z.number().int().min(1).max(1095),active:z.boolean()}).strict()}).strict(),
 z.object({requestId:z.uuid(),operation:z.literal("intake_save"),data:z.object({...base,title:z.string().trim().min(2).max(200),slug:z.string().max(150).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),category:z.string().trim().min(2).max(150),department:z.string().trim().min(2).max(150),summary:z.string().trim().min(10).max(1000),description:z.string().trim().min(10).max(10000),serviceDescription:z.string().trim().min(40).max(5000),location:z.string().trim().min(2).max(200),status:z.enum(["draft","published","paused","closed","archived"]),requiredDocuments:z.array(documentKind).max(5),questions:questionSchema}).strict()}).strict()
]);

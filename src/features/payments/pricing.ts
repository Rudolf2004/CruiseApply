import { z } from "zod";
export const quoteSchema = z.object({
  id: z.uuid(), product_name: z.string(), country_code: z.string(), region_code: z.string().nullable(),
  validity_days: z.number().int().positive(), charge_amount: z.number().int().positive(), charge_currency: z.literal("GHS"),
  display_amount: z.number().int().positive().safe(), display_currency: z.string().regex(/^[A-Z]{3}$/),
  display_minor_units: z.number().int().min(0).max(4), exchange_rate: z.number().positive().nullable(),
  exchange_rate_source: z.string().nullable(), exchange_rate_as_of: z.string().nullable(), expires_at: z.string()
});
export type PriceQuote = z.infer<typeof quoteSchema>;
export function formatAmount(amount: number, currency: string, minorUnits = 2) {
  return new Intl.NumberFormat("en", { style: "currency", currency, minimumFractionDigits: minorUnits, maximumFractionDigits: minorUnits }).format(amount / 10 ** minorUnits);
}

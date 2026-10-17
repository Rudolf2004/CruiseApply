import { formatAmount } from "./pricing";
export type Snapshot = {
  charge_amount: number; charge_currency: string; display_amount: number | null; display_currency: string | null;
  display_minor_units: number | null; exchange_rate: number | null; exchange_rate_source: string | null;
  exchange_rate_as_of: string | null; country_code: string | null;
};
export function PriceSnapshot({ payment }: { payment: Snapshot }) {
  return <div><p className="font-bold text-xl mt-3">Charge: {formatAmount(payment.charge_amount, payment.charge_currency)}</p>{payment.display_amount !== null && payment.display_currency && payment.display_currency !== payment.charge_currency && <><p className="text-sm mt-2">Estimate shown at checkout: {formatAmount(payment.display_amount, payment.display_currency, payment.display_minor_units ?? 2)}</p><p className="muted text-xs mt-2">1 {payment.charge_currency} = {payment.exchange_rate} {payment.display_currency} · {payment.exchange_rate_source}{payment.exchange_rate_as_of && ` · ${new Date(payment.exchange_rate_as_of).toLocaleDateString("en-GB")}`}. This estimate is not the amount charged by your bank.</p></>}{payment.country_code && <p className="muted text-xs mt-2">Selected country: {new Intl.DisplayNames(["en"], { type: "region" }).of(payment.country_code)}</p>}</div>;
}

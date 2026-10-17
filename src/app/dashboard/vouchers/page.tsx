import { requireUser } from "@/lib/auth";
import { ButtonLink, Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
export default async function Vouchers({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { user, db } = await requireUser(); const params = await searchParams;
  const page = Math.floor(Math.max(1, Math.min(10000, Number(params.page) || 1))); const from = (page - 1) * 20;
  const { data, error, count } = await db.from("vouchers").select("id,serial,status,expires_at", { count: "exact" }).eq("user_id", user.id).order("purchased_at", { ascending: false }).range(from, from + 19);
  if (error) throw new Error("Your vouchers are unavailable.");
  return <><PageHeader title="My Vouchers" description="View your voucher credentials and payment receipt."><ButtonLink href="/buy-voucher">Buy a voucher</ButtonLink></PageHeader><div className="grid gap-4">{data.map(voucher => <Card key={voucher.id}><div className="flex flex-wrap justify-between gap-3"><h2 className="font-bold">{voucher.serial}</h2><StatusBadge status={voucher.status === "unused" && new Date(voucher.expires_at).getTime() <= new Date().getTime() ? "expired" : voucher.status}/></div><p className="muted text-sm my-4">Expires {new Date(voucher.expires_at).toLocaleDateString("en-GB")}</p><ButtonLink secondary href={`/dashboard/vouchers/${voucher.id}`}>View voucher & receipt</ButtonLink></Card>)}</div>{!data.length && <EmptyState title="No vouchers yet" description="A voucher appears here once your payment has been verified."/>}<div className="flex gap-4 mt-6">{page > 1 && <ButtonLink secondary href={`?page=${page - 1}`}>Previous</ButtonLink>}{from + 20 < (count ?? 0) && <ButtonLink secondary href={`?page=${page + 1}`}>Next</ButtonLink>}</div></>;
}

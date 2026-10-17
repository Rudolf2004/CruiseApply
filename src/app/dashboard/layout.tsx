import { requireUser } from "@/lib/auth";
import { DashboardShell } from "@/features/dashboard/shell";
export const metadata = { title:"Your dashboard", robots:{index:false,follow:false} };
export default async function DashboardLayout({children}:{children:React.ReactNode}) { const {profile}=await requireUser();return <DashboardShell name={profile.full_name}>{children}</DashboardShell>; }

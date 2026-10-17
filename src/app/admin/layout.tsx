import {requireUser} from "@/lib/auth";
import {AdminShell} from "@/features/admin-overview/shell";
export const metadata={title:"Administration",robots:{index:false,follow:false}};
export default async function AdminLayout({children}:{children:React.ReactNode}){const {profile}=await requireUser(true);return <AdminShell name={profile.full_name} role={profile.role}>{children}</AdminShell>;}

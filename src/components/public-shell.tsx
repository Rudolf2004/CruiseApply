import { SiteHeader } from "./site-header";
import { SiteFooter } from "./site-footer";
export function PublicShell({ children }: { children: React.ReactNode }) { return <><SiteHeader/>{children}<SiteFooter/></>; }

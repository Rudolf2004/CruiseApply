import { PublicShell } from "@/components/public-shell";
import { EmptyState } from "@/components/ui";
export default function NotFound() { return <PublicShell><main id="main" className="container py-20"><EmptyState title="This page has sailed away" description="The page or opportunity may have moved, closed, or is no longer available." href="/jobs" action="Browse opportunities"/></main></PublicShell>; }

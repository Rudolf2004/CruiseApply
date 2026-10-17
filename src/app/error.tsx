"use client";
import { Alert, Button } from "@/components/ui";
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main id="main" className="container py-24 max-w-2xl"><h1 className="text-3xl font-bold mb-6">Something went wrong</h1><Alert error>We couldn’t load this page. Please try again.</Alert><Button onClick={reset} className="mt-6">Try again</Button></main>;
}

"use client";
import { Alert, Button } from "@/components/ui";
export default function ErrorPage({reset}:{reset:()=>void}){return <main id="main" className="container py-16"><Alert error>The applicant portal is temporarily unavailable. Your saved application is unchanged.</Alert><Button className="mt-5" onClick={reset}>Try again</Button></main>;}

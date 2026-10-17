"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { sendJson } from "@/lib/client-api";
export function ReadNotificationButton({ id }: { id: string }) {
  const router = useRouter(); const [busy,setBusy] = useState(false); const [error,setError] = useState("");
  return <div><Button className="secondary" disabled={busy} onClick={async () => {
    setBusy(true); setError("");
    try { await sendJson(`/api/notifications/${id}/read`,{}); router.refresh(); }
    catch { setError("Could not mark this update as read. Please try again."); }
    finally { setBusy(false); }
  }}>{busy ? "Saving…" : "Mark as read"}</Button>{error && <p role="alert" className="text-red-700 text-sm mt-2">{error}</p>}</div>;
}

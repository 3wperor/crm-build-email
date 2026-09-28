"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-renders the server component periodically while the import is running. */
export function AutoRefresh({ active, intervalMs = 1500 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs, router]);
  return null;
}

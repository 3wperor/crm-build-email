"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Re-renders the page when rows change in the given tables (Supabase
 * Realtime; RLS applies to what the browser receives). Debounced so a burst
 * of replies causes one refresh. Silently does nothing if Realtime is off.
 */
export function RealtimeRefresh({ orgId, tables }: { orgId: string; tables: string[] }) {
  const router = useRouter();
  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 500);
    };
    const channel = supabase.channel(`rt-${tables.join("-")}-${orgId}`);
    for (const table of tables) {
      channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `org_id=eq.${orgId}` }, bump);
    }
    channel.subscribe();
    return () => {
      clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [orgId, tables, router]);
  return null;
}

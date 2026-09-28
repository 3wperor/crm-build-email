import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@crm/db";
import { publicEnv } from "@/lib/env";

export function createClient() {
  return createBrowserClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey);
}

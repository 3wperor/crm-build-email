import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@crm/db";
import { publicEnv, serverEnv } from "@/lib/env";

/**
 * Service-role client: BYPASSES RLS. Use only in trusted server code
 * (background jobs, credential storage) and always filter by org_id explicitly.
 */
export function createAdminClient() {
  return createClient<Database>(publicEnv.supabaseUrl, serverEnv().supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

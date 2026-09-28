import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export const IMPORTS_BUCKET = "imports";

// Every object lives under the org's folder; paths are derived, never user-supplied.
export const importFilePath = (orgId: string, importId: string) => `${orgId}/${importId}.csv`;
export const importErrorsPath = (orgId: string, importId: string) => `${orgId}/${importId}-errors.csv`;

export async function downloadText(path: string): Promise<string> {
  const { data, error } = await createAdminClient().storage.from(IMPORTS_BUCKET).download(path);
  if (error || !data) throw new Error(`Could not read ${path}: ${error?.message ?? "not found"}`);
  return data.text();
}

export async function uploadText(path: string, text: string): Promise<void> {
  const { error } = await createAdminClient()
    .storage.from(IMPORTS_BUCKET)
    .upload(path, new Blob([text], { type: "text/csv" }), { upsert: true, contentType: "text/csv" });
  if (error) throw new Error(`Could not write ${path}: ${error.message}`);
}

import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { IMPORTS_BUCKET } from "@/lib/imports/storage";

/** Redirects to a short-lived signed URL for the import's error CSV. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { org } = await getOrgContext();
  // RLS-scoped read proves the caller can see this import.
  const supabase = await createClient();
  const { data: imp } = await supabase
    .from("imports")
    .select("error_report_path, filename")
    .eq("org_id", org.id)
    .eq("id", id)
    .maybeSingle();
  if (!imp?.error_report_path) return new NextResponse("Not found", { status: 404 });

  const base = imp.filename.replace(/\.(csv|txt)$/i, "");
  const { data, error } = await createAdminClient()
    .storage.from(IMPORTS_BUCKET)
    .createSignedUrl(imp.error_report_path, 60, { download: `${base}-errors.csv` });
  if (error || !data) return new NextResponse("Could not create download link", { status: 500 });
  return NextResponse.redirect(data.signedUrl);
}

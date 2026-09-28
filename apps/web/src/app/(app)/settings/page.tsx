import Link from "next/link";
import { can } from "@crm/core";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/coming-soon";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { org, role } = await getOrgContext();
  const supabase = await createClient();

  const [{ data: settings }, { data: members }] = await Promise.all([
    supabase.from("organizations").select("name, physical_address, default_timezone, approval_mode").eq("id", org.id).single(),
    supabase.from("memberships").select("id, role, created_at, users(email, full_name)").eq("org_id", org.id).order("created_at"),
  ]);

  return (
    <>
      <PageHeader
        title="Settings"
        actions={
          <Link href="/settings/audit-log" className="text-sm underline underline-offset-4">
            Audit log
          </Link>
        }
      />
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Workspace</CardTitle>
            <CardDescription>Compliance footer, timezone and AI agent guardrails.</CardDescription>
          </CardHeader>
          <CardContent>
            {settings && <SettingsForm org={settings} disabled={!can(role, "org.update")} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <CardDescription>Invitations arrive with SaaS mode; solo workspaces have a single owner.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(members ?? []).map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>{m.users?.email}</TableCell>
                    <TableCell>{m.users?.full_name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="capitalize">
                        {m.role}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

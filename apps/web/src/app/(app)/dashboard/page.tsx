import Link from "next/link";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/coming-soon";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const { org } = await getOrgContext();
  const supabase = await createClient();

  const count = async (table: "leads" | "campaigns" | "sending_accounts" | "replies" | "opportunities") => {
    const { count } = await supabase.from(table).select("id", { count: "exact", head: true }).eq("org_id", org.id);
    return count ?? 0;
  };
  const [leads, campaigns, inboxes, replies, opportunities] = await Promise.all([
    count("leads"),
    count("campaigns"),
    count("sending_accounts"),
    count("replies"),
    count("opportunities"),
  ]);

  const stats = [
    { label: "Leads", value: leads, href: "/leads" },
    { label: "Campaigns", value: campaigns, href: "/campaigns" },
    { label: "Inboxes", value: inboxes, href: "/inboxes" },
    { label: "Replies", value: replies, href: "/replies" },
    { label: "In pipeline", value: opportunities, href: "/pipeline" },
  ];

  return (
    <>
      <PageHeader title="Dashboard" description={org.name} />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {stats.map((s) => (
          <Link key={s.label} href={s.href}>
            <Card className="hover:bg-muted/50 gap-2 transition-colors">
              <CardHeader>
                <CardDescription>{s.label}</CardDescription>
                <CardTitle className="text-3xl tabular-nums">{s.value.toLocaleString()}</CardTitle>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}

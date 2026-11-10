import { redirect } from "next/navigation";
import { can } from "@crm/core";
import { guessEmailProvider } from "@crm/core/growth";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/coming-soon";
import { Card, CardContent } from "@/components/ui/card";
import { AccountForm } from "./account-form";

export const metadata = { title: "Add inbox" };
// Connection tests make outbound SMTP + IMAP handshakes.
export const maxDuration = 60;

export default async function NewInboxPage() {
  const { org, role, user } = await getOrgContext();
  if (!can(role, "sending_accounts.manage")) redirect("/inboxes");
  const { data: answers } = await (await createClient()).from("organizations").select("onboarding_provider").eq("id", org.id).single();

  return (
    <>
      <PageHeader title="Add inbox" description="Connect a mailbox with an app password. We test SMTP and IMAP before you send." />
      <Card>
        <CardContent>
          <AccountForm answer={answers?.onboarding_provider ?? guessEmailProvider(user.email)} />
        </CardContent>
      </Card>
    </>
  );
}

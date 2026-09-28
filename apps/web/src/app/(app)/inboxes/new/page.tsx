import { redirect } from "next/navigation";
import { can } from "@crm/core";
import { getOrgContext } from "@/lib/org";
import { PageHeader } from "@/components/coming-soon";
import { Card, CardContent } from "@/components/ui/card";
import { AccountForm } from "./account-form";

export const metadata = { title: "Add inbox" };
// Connection tests make outbound SMTP + IMAP handshakes.
export const maxDuration = 60;

export default async function NewInboxPage() {
  const { role } = await getOrgContext();
  if (!can(role, "sending_accounts.manage")) redirect("/inboxes");

  return (
    <>
      <PageHeader title="Add inbox" description="Connect a mailbox with an app password. We test SMTP and IMAP before you send." />
      <Card>
        <CardContent>
          <AccountForm />
        </CardContent>
      </Card>
    </>
  );
}

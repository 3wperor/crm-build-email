import { ComingSoon, PageHeader } from "@/components/coming-soon";

export const metadata = { title: "Inboxes" };

export default function Page() {
  return (
    <>
      <PageHeader title="Inboxes" description="Connected Google / SMTP sending accounts." />
      <ComingSoon phase={2} what="Add accounts with app passwords (encrypted at rest), test SMTP + IMAP, per-inbox caps and health." />
    </>
  );
}

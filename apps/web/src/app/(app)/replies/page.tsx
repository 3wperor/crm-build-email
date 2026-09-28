import { ComingSoon, PageHeader } from "@/components/coming-soon";

export const metadata = { title: "Replies" };

export default function Page() {
  return (
    <>
      <PageHeader title="Replies" description="Replies detected across all inboxes." />
      <ComingSoon phase={7} what="IMAP polling, reply matching, classification and automatic pipeline entry." />
    </>
  );
}

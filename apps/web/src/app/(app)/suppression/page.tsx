import { ComingSoon, PageHeader } from "@/components/coming-soon";

export const metadata = { title: "Suppression list" };

export default function Page() {
  return (
    <>
      <PageHeader title="Suppression list" description="Addresses that will never be emailed." />
      <ComingSoon phase={3} what="Manual add/remove and CSV import; auto-populated by unsubscribes and hard bounces." />
    </>
  );
}

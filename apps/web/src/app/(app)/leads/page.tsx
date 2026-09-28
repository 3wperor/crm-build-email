import { ComingSoon, PageHeader } from "@/components/coming-soon";

export const metadata = { title: "Leads" };

export default function Page() {
  return (
    <>
      <PageHeader title="Leads" description="Upload, verify and manage prospects." />
      <ComingSoon phase={3} what="CSV drag-and-drop with column mapping, dedupe and suppression checks (verification in Phase 4)." />
    </>
  );
}

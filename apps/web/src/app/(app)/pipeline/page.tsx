import { ComingSoon, PageHeader } from "@/components/coming-soon";

export const metadata = { title: "Pipeline" };

export default function Page() {
  return (
    <>
      <PageHeader title="Pipeline" description="Leads enter only by replying (or manual drag)." />
      <ComingSoon phase={8} what="Kanban board with customizable stages and full thread history." />
    </>
  );
}

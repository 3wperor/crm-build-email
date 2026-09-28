import { ComingSoon, PageHeader } from "@/components/coming-soon";

export const metadata = { title: "Analytics" };

export default function Page() {
  return (
    <>
      <PageHeader title="Analytics" description="Per campaign, inbox and variant." />
      <ComingSoon phase={9} what="Sent / delivered / open / click / reply / bounce / unsubscribe rates over time, A/B confidence." />
    </>
  );
}

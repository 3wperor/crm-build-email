import { ComingSoon, PageHeader } from "@/components/coming-soon";

export const metadata = { title: "Campaigns" };

export default function Page() {
  return (
    <>
      <PageHeader title="Campaigns" description="Multi-step sequences with send windows, volume limits and A/B variants." />
      <ComingSoon phase={5} what="Sequence builder, scheduler, daily volume slider, send window and live next-send estimate." />
    </>
  );
}

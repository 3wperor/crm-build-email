import { ComingSoon, PageHeader } from "@/components/coming-soon";

export const metadata = { title: "Warmup" };

export default function Page() {
  return (
    <>
      <PageHeader title="Warmup" description="Internal warmup pool (beta)." />
      <ComingSoon phase={10} what="Opt-in ramp schedules between your own inboxes with health scoring." />
    </>
  );
}

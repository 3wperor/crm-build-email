import Link from "next/link";
import { ErrorScreen } from "@/components/error-screen";
import { Button } from "@/components/ui/button";

export default function AppNotFound() {
  return (
    <ErrorScreen fullPage={false} code="404" title="We can't find that" description="It may have been deleted, or it belongs to a different workspace.">
      <Button asChild>
        <Link href="/dashboard">Go to your dashboard</Link>
      </Button>
    </ErrorScreen>
  );
}

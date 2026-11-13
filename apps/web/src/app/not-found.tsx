import Link from "next/link";
import { ErrorScreen } from "@/components/error-screen";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <ErrorScreen code="404" title="We can't find that page" description="The link may be old, or the page may have been moved or deleted.">
      <Button asChild>
        <Link href="/dashboard">Go to your dashboard</Link>
      </Button>
      <Button asChild variant="outline">
        <Link href="/">Homepage</Link>
      </Button>
    </ErrorScreen>
  );
}

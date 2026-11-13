"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ErrorScreen } from "@/components/error-screen";
import { Button } from "@/components/ui/button";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <ErrorScreen
      title="Something went wrong"
      description="That's on us, not you. Nothing you've saved is lost. Try again, and if it keeps happening, tell us what you were doing."
    >
      <Button onClick={reset}>Try again</Button>
      <Button asChild variant="outline">
        <Link href="/">Homepage</Link>
      </Button>
    </ErrorScreen>
  );
}

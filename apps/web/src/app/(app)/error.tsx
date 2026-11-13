"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ErrorScreen } from "@/components/error-screen";
import { Button } from "@/components/ui/button";

/** Errors inside the app keep the sidebar, so there's always a way to somewhere else. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <ErrorScreen
      fullPage={false}
      title="This page couldn't load"
      description="That's on us, not you. Your campaigns and sending aren't affected. Try again, or pick another page from the menu."
    >
      <Button onClick={reset}>Try again</Button>
      <Button asChild variant="outline">
        <Link href="/dashboard">Go to your dashboard</Link>
      </Button>
    </ErrorScreen>
  );
}

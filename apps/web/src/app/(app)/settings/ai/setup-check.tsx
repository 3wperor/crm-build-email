"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, CircleAlert, CircleX, Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { checkAiSetup } from "./actions";

type Check = { label: string; status: "ok" | "warn" | "fail"; detail: string };

const ICON = {
  ok: <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label="OK" />,
  warn: <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-label="Warning" />,
  fail: <CircleX className="text-destructive mt-0.5 size-4 shrink-0" aria-label="Problem" />,
};

/** Site-admin only: runs every AI check and shows the real reasons. */
export function AiSetupCheck() {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Card className="border-dashed" data-testid="ai-setup-check">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Stethoscope className="size-4" /> Check AI setup
        </CardTitle>
        <CardDescription>
          Only you can see this (site admin). It tests the database, the AI key on the server, a live call, this workspace&apos;s plan and its hidden
          monthly allowance, and shows the real error if anything fails.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const res = await checkAiSetup();
                setChecks(res.checks ?? null);
                setError(res.error ?? null);
              })
            }
          >
            {pending ? "Checking… (up to 30 seconds)" : "Run the check"}
          </Button>
        </div>
        {error && <p className="text-destructive text-sm">{error}</p>}
        {checks && (
          <ul className="grid gap-3" aria-live="polite">
            {checks.map((c) => (
              <li key={c.label} className="flex items-start gap-2 text-sm">
                {ICON[c.status]}
                <div>
                  <div className="font-medium">{c.label}</div>
                  <div className="text-muted-foreground break-words">{c.detail}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

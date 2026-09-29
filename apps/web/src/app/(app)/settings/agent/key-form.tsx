"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createApiKey } from "./actions";

export function CreateKeyForm({ appUrl }: { appUrl: string }) {
  const [state, action, pending] = useActionState(createApiKey, undefined);
  return (
    <div className="grid gap-3">
      <form action={action} className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="key-name">Key name</Label>
          <Input id="key-name" name="name" placeholder="Claude Desktop" className="w-64" maxLength={100} />
        </div>
        <Button disabled={pending}>{pending ? "Creating…" : "Create API key"}</Button>
      </form>
      {state?.error && <p className="text-destructive text-sm">{state.error}</p>}
      {state?.key && (
        <Alert>
          <AlertDescription>
            <div className="grid gap-2">
              <span>
                Copy the key for <strong>{state.name}</strong> now. It won&apos;t be shown again.
              </span>
              <code className="bg-muted rounded px-2 py-1 text-xs break-all" data-testid="new-api-key">
                {state.key}
              </code>
              <span className="text-muted-foreground text-xs">
                MCP server: <code>YCAREACH_URL={appUrl} YCAREACH_API_KEY=&lt;key&gt; pnpm --filter @crm/mcp start</code>
              </span>
            </div>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

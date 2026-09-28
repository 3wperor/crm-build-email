import { CheckCircle2, XCircle } from "lucide-react";
import type { CheckResult, ConnectionTestResult } from "@crm/core";

// Errors are prefixed with the protocol ("SMTP authentication failed"); the row label already says it.
function stripProtocol(error: string): string {
  const rest = error.replace(/^(SMTP|IMAP) /, "");
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

function Row({ label, result }: { label: string; result: CheckResult }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      {result.ok ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
      ) : (
        <XCircle className="text-destructive mt-0.5 size-4 shrink-0" />
      )}
      <div>
        <div>
          <span className="font-medium">{label}:</span>{" "}
          {result.ok ? <span className="text-muted-foreground">connected in {result.latencyMs} ms</span> : stripProtocol(result.error)}
        </div>
        {!result.ok && result.hint && <div className="text-muted-foreground text-xs">{result.hint}</div>}
      </div>
    </div>
  );
}

export function ConnectionResult({ result }: { result: ConnectionTestResult }) {
  return (
    <div className="grid gap-2 rounded-md border p-3" aria-live="polite">
      <Row label="SMTP (sending)" result={result.smtp} />
      <Row label="IMAP (reply detection)" result={result.imap} />
    </div>
  );
}

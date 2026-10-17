"use client";

import { useRef, useState, useTransition } from "react";
import { FileUp } from "lucide-react";
import { SPREADSHEET_ACCEPT, emailsFromParsed } from "@crm/core/imports";
import { Button } from "@/components/ui/button";
import { readSpreadsheetFile } from "@/lib/spreadsheet";
import { addSuppressionBatch } from "./actions";

const BATCH = 5000;

/** Suppress every address in a CSV or Excel file (the email column is found automatically). */
export function SuppressionUploadForm() {
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();

  function onFile(file: File) {
    setStatus(null);
    start(async () => {
      let emails: string[];
      try {
        emails = emailsFromParsed(await readSpreadsheetFile(file));
      } catch (e) {
        return setStatus({ error: e instanceof Error ? e.message : "Couldn't read that file." });
      }
      if (emails.length === 0) return setStatus({ error: "No email addresses found in that file." });
      let added = 0;
      let already = 0;
      for (let i = 0; i < emails.length; i += BATCH) {
        const r = await addSuppressionBatch(emails.slice(i, i + BATCH));
        if (r?.error) return setStatus({ error: `Stopped after ${added} added: ${r.error}` });
        added += r?.added ?? 0;
        already += r?.already ?? 0;
      }
      setStatus({ ok: `${file.name}: found ${emails.length.toLocaleString()} addresses · added ${added.toLocaleString()}${already ? ` · ${already.toLocaleString()} already suppressed` : ""}.` });
      if (input.current) input.current.value = "";
    });
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" disabled={pending} onClick={() => input.current?.click()}>
          <FileUp /> {pending ? "Reading…" : "Upload CSV or Excel"}
        </Button>
        <span className="text-muted-foreground text-xs">The column with email addresses is found automatically; other columns are ignored.</span>
      </div>
      <input
        ref={input}
        type="file"
        accept={SPREADSHEET_ACCEPT}
        className="hidden"
        data-testid="suppression-file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
      {status?.ok && <p className="text-sm text-emerald-600">{status.ok}</p>}
      {status?.error && <p className="text-destructive text-sm">{status.error}</p>}
    </div>
  );
}

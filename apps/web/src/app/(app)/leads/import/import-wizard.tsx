"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Loader2 } from "lucide-react";
import {
  LEAD_FIELDS,
  LEAD_FIELD_LABELS,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  customKey,
  detectColumnMapping,
  parseCsv,
  prepareRows,
  validateMapping,
  type ColumnMapping,
  type ColumnTarget,
  type ParsedCsv,
} from "@crm/core/imports";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select-native";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { queueImport, startImport } from "../actions";

type ListChoice = "none" | "new" | string; // string = existing list id

export function ImportWizard({ lists }: { lists: { id: string; name: string }[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [csv, setCsv] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>([]);
  const [mode, setMode] = useState<"skip" | "fill">("skip");
  const [listChoice, setListChoice] = useState<ListChoice>("new");
  const [newListName, setNewListName] = useState("");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const loadFile = useCallback(async (f: File) => {
    setError(null);
    if (!/\.(csv|txt)$/i.test(f.name)) return setError("Choose a .csv file.");
    if (f.size > MAX_IMPORT_BYTES) return setError("File is larger than 20 MB. Split it into smaller files.");
    const parsed = parseCsv(await f.text());
    if (parsed.headers.length === 0 || parsed.rows.length === 0) return setError("The file has no data rows.");
    if (parsed.rows.length > MAX_IMPORT_ROWS) return setError(`Max ${MAX_IMPORT_ROWS.toLocaleString()} rows per import.`);
    setFile(f);
    setCsv(parsed);
    setMapping(detectColumnMapping(parsed.headers, parsed.rows.slice(0, 20)));
    setNewListName(f.name.replace(/\.(csv|txt)$/i, ""));
  }, []);

  const mappingError = csv ? validateMapping(mapping, csv.headers.length) : null;
  // Client-side dry run for an instant summary (the server re-validates everything).
  const dryRun = useMemo(() => (csv && !mappingError ? prepareRows(csv.rows, mapping) : null), [csv, mapping, mappingError]);

  function setTarget(index: number, target: ColumnTarget) {
    setMapping((m) => m.map((t, i) => (i === index ? target : t)));
  }

  function submit() {
    if (!file || !csv || mappingError) return;
    setError(null);
    startTransition(async () => {
      setStage("Preparing…");
      const list =
        listChoice === "none"
          ? ({ type: "none" } as const)
          : listChoice === "new"
            ? ({ type: "new", name: newListName } as const)
            : ({ type: "existing", id: listChoice } as const);
      const res = await startImport({
        filename: file.name,
        size: file.size,
        columnCount: csv.headers.length,
        totalRows: csv.rows.length,
        mapping,
        mode,
        list,
      });
      if ("error" in res) {
        setStage(null);
        return setError(res.error);
      }

      setStage("Uploading…");
      const { error: uploadError } = await createClient()
        .storage.from("imports")
        .uploadToSignedUrl(res.path, res.token, file, { contentType: "text/csv" });
      if (uploadError) {
        setStage(null);
        return setError(`Upload failed: ${uploadError.message}`);
      }

      setStage("Queuing…");
      const queued = await queueImport(res.importId);
      if (queued.error) {
        setStage(null);
        return setError(queued.error);
      }
      router.push(`/leads/imports/${res.importId}`);
    });
  }

  if (!csv) {
    return (
      <div className="grid gap-4">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files[0];
            if (f) void loadFile(f);
          }}
          className={cn(
            "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-12 text-center transition-colors",
            dragging ? "border-primary bg-primary/5" : "hover:bg-muted/50",
          )}
        >
          <FileUp className="text-muted-foreground size-8" />
          <div className="font-medium">Drop a CSV here or click to choose</div>
          <div className="text-muted-foreground text-sm">Up to 20 MB / {MAX_IMPORT_ROWS.toLocaleString()} rows. First row must be headers.</div>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv,.txt"
          className="hidden"
          data-testid="csv-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void loadFile(f);
          }}
        />
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
    );
  }

  const preview = csv.rows.slice(0, 5);

  return (
    // minmax(0,1fr): let the wide mapping table scroll instead of stretching the page.
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {file?.name} · {csv.rows.length.toLocaleString()} rows
          </CardTitle>
          <CardDescription>Check how each column maps to lead fields. Unmapped columns can be kept as custom fields.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                {csv.headers.map((h, i) => (
                  <TableHead key={i} className="min-w-44 align-top">
                    <div className="grid gap-1 py-2">
                      <span className="text-muted-foreground truncate text-xs font-normal">{h || `Column ${i + 1}`}</span>
                      <NativeSelect
                        aria-label={`Map column ${h || i + 1}`}
                        value={mapping[i]}
                        onChange={(e) => setTarget(i, e.target.value as ColumnTarget)}
                        className={cn(mapping[i] === "email" && "border-primary")}
                      >
                        {LEAD_FIELDS.map((f) => (
                          <option key={f} value={f}>
                            {LEAD_FIELD_LABELS[f]}
                          </option>
                        ))}
                        {(() => {
                          const current = mapping[i];
                          const value = current?.startsWith("custom:") ? current : `custom:${customKey(h || `column_${i + 1}`)}`;
                          return <option value={value}>Custom: {value.slice(7)}</option>;
                        })()}
                        <option value="ignore">Don&apos;t import</option>
                      </NativeSelect>
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.map((row, r) => (
                <TableRow key={r}>
                  {csv.headers.map((_, i) => (
                    <TableCell key={i} className={cn("max-w-56 truncate", mapping[i] === "ignore" && "text-muted-foreground/50")}>
                      {row[i]}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Options</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="list">Add leads to list</Label>
            <NativeSelect id="list" value={listChoice} onChange={(e) => setListChoice(e.target.value)}>
              <option value="new">New list…</option>
              <option value="none">No list</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </NativeSelect>
            {listChoice === "new" && (
              <Input aria-label="New list name" value={newListName} onChange={(e) => setNewListName(e.target.value)} maxLength={120} />
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="mode">Leads that already exist</Label>
            <NativeSelect id="mode" value={mode} onChange={(e) => setMode(e.target.value as "skip" | "fill")}>
              <option value="skip">Skip them (listed in the error report)</option>
              <option value="fill">Fill in their empty fields (never overwrite)</option>
            </NativeSelect>
          </div>
        </CardContent>
      </Card>

      {mappingError && (
        <Alert variant="destructive">
          <AlertDescription>{mappingError}</AlertDescription>
        </Alert>
      )}
      {dryRun && (
        <p className="text-muted-foreground text-sm" data-testid="dry-run">
          {dryRun.leads.length.toLocaleString()} valid unique rows ·{" "}
          {dryRun.rejected.filter((r) => r.reason !== "duplicate_in_file").length.toLocaleString()} invalid ·{" "}
          {dryRun.rejected.filter((r) => r.reason === "duplicate_in_file").length.toLocaleString()} duplicates in file. Existing leads and
          suppressed addresses are checked on import.
        </p>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex gap-2">
        <Button onClick={submit} disabled={pending || !!mappingError || !dryRun?.leads.length}>
          {pending && <Loader2 className="animate-spin" />}
          {stage ?? `Import ${dryRun?.leads.length.toLocaleString() ?? 0} leads`}
        </Button>
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => {
            setCsv(null);
            setFile(null);
          }}
        >
          Choose another file
        </Button>
      </div>
    </div>
  );
}

"use client";

import { useActionState, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/select-native";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { bulkLeadAction } from "./actions";

export type LeadRow = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  title: string | null;
  status: string;
  verification_status: string;
  created_at: string;
};

const VERIFY_VARIANT = {
  valid: "success",
  risky: "warning",
  invalid: "destructive",
  unknown: "outline",
  pending: "outline",
  unverified: "outline",
} as const;

const STATUS_VARIANT: Record<string, "secondary" | "destructive" | "warning" | "success" | "outline"> = {
  new: "outline",
  in_sequence: "secondary",
  replied: "success",
  bounced: "destructive",
  unsubscribed: "warning",
  do_not_contact: "warning",
};

export function LeadsTable({ rows, lists, canWrite }: { rows: LeadRow[]; lists: { id: string; name: string }[]; canWrite: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [action, setAction] = useState("add_to_list");
  const [state, formAction, pending] = useActionState(bulkLeadAction, undefined);

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <form
      action={(fd) => {
        formAction(fd);
        setSelected(new Set());
      }}
      onSubmit={(e) => {
        if (action === "delete" && !window.confirm(`Delete ${selected.size} lead(s)? This also removes their campaign history.`)) {
          e.preventDefault();
        }
        if (action === "suppress" && !window.confirm(`Suppress ${selected.size} lead(s)? They will never be emailed.`)) {
          e.preventDefault();
        }
      }}
      className="grid gap-3"
    >
      {canWrite && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-sm">{selected.size} selected</span>
          <NativeSelect name="bulk_action" value={action} onChange={(e) => setAction(e.target.value)} className="w-auto" aria-label="Bulk action">
            <option value="add_to_list">Add to list</option>
            <option value="suppress">Add to suppression list</option>
            <option value="delete">Delete</option>
          </NativeSelect>
          {action === "add_to_list" && (
            <NativeSelect name="list_id" className="w-auto" aria-label="List" defaultValue="">
              <option value="" disabled>
                Choose list…
              </option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </NativeSelect>
          )}
          <Button size="sm" variant={action === "add_to_list" ? "outline" : "destructive"} disabled={selected.size === 0 || pending}>
            Apply
          </Button>
          {state?.message && <span className="text-sm text-emerald-600">{state.message}</span>}
        </div>
      )}
      {state?.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {[...selected].map((id) => (
        <input key={id} type="hidden" name="lead_id" value={id} />
      ))}

      <Table>
        <TableHeader>
          <TableRow>
            {canWrite && (
              <TableHead className="w-8">
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                />
              </TableHead>
            )}
            <TableHead>Email</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Company</TableHead>
            <TableHead>Title</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Verification</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} data-state={selected.has(r.id) ? "selected" : undefined}>
              {canWrite && (
                <TableCell>
                  <input type="checkbox" aria-label={`Select ${r.email}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                </TableCell>
              )}
              <TableCell className="font-medium">{r.email}</TableCell>
              <TableCell>{[r.first_name, r.last_name].filter(Boolean).join(" ") || "—"}</TableCell>
              <TableCell className="max-w-48 truncate">{r.company ?? "—"}</TableCell>
              <TableCell className="max-w-48 truncate">{r.title ?? "—"}</TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[r.status] ?? "outline"}>{r.status.replaceAll("_", " ")}</Badge>
              </TableCell>
              <TableCell>
                <Badge variant={VERIFY_VARIANT[r.verification_status as keyof typeof VERIFY_VARIANT] ?? "outline"}>
                  {r.verification_status}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </form>
  );
}

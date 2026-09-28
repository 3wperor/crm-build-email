import Papa from "papaparse";
import { isValidEmailSyntax, normalizeEmail } from "./email";

/**
 * CSV lead import: parsing, column auto-mapping, row validation and in-file
 * de-duplication. Pure and deterministic — the background job re-runs it per
 * chunk and must get identical results every time.
 *
 * Checks against the database (existing leads, suppression list) happen in
 * SQL (`import_leads_chunk`), set-based, per chunk.
 */

export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 100_000;
export const IMPORT_CHUNK_SIZE = 1000;
const MAX_FIELD_LENGTH = 500;

export const LEAD_FIELDS = ["email", "first_name", "last_name", "full_name", "company", "title"] as const;
export type LeadField = (typeof LEAD_FIELDS)[number];

export const LEAD_FIELD_LABELS: Record<LeadField, string> = {
  email: "Email",
  first_name: "First name",
  last_name: "Last name",
  full_name: "Full name (split into first/last)",
  company: "Company",
  title: "Job title",
};

/**
 * One entry per CSV column (by index — headers can repeat):
 *   a LeadField, "custom:<key>", or "ignore".
 */
export type ColumnTarget = LeadField | `custom:${string}` | "ignore";
export type ColumnMapping = ColumnTarget[];

export type ImportMode = "skip" | "fill";

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export type ParsedCsv = { headers: string[]; rows: string[][] };

export function parseCsv(text: string): ParsedCsv {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const result = Papa.parse<string[]>(clean, { skipEmptyLines: "greedy" });
  const [headerRow = [], ...rows] = result.data;
  return { headers: headerRow.map((h) => String(h ?? "").trim()), rows };
}

// ---------------------------------------------------------------------------
// Column auto-detection
// ---------------------------------------------------------------------------

const SYNONYMS: Record<Exclude<LeadField, never>, string[]> = {
  email: ["email", "emailaddress", "e-mail", "mail", "workemail", "businessemail", "contactemail", "emailid", "primaryemail"],
  first_name: ["firstname", "first", "givenname", "fname", "forename"],
  last_name: ["lastname", "last", "surname", "familyname", "lname"],
  full_name: ["name", "fullname", "contactname", "contact", "personname"],
  company: ["company", "companyname", "organization", "organisation", "org", "account", "accountname", "employer", "business"],
  title: ["title", "jobtitle", "position", "role", "designation", "jobrole"],
};

function squash(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** snake_case key for custom fields, e.g. "LinkedIn URL" → "linkedin_url". */
export function customKey(header: string): string {
  const key = header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return key || "field";
}

export function detectColumnMapping(headers: string[], sampleRows: string[][] = []): ColumnMapping {
  const used = new Set<LeadField>();
  const usedCustom = new Set<string>();

  const mapping: ColumnMapping = headers.map((header) => {
    const s = squash(header);
    for (const field of LEAD_FIELDS) {
      const synonyms = SYNONYMS[field].map(squash);
      if (!used.has(field) && synonyms.includes(s)) {
        used.add(field);
        return field;
      }
    }
    return "ignore";
  });

  // No header matched email? Pick the column whose sample values look like emails.
  if (!used.has("email") && sampleRows.length > 0) {
    let best = -1;
    let bestHits = 0;
    headers.forEach((_, i) => {
      if (mapping[i] !== "ignore") return;
      const hits = sampleRows.filter((r) => extractEmail(r[i] ?? "") !== null).length;
      if (hits > bestHits) {
        best = i;
        bestHits = hits;
      }
    });
    if (best >= 0 && bestHits >= Math.ceil(sampleRows.length / 2)) {
      mapping[best] = "email";
      used.add("email");
    }
  }

  // Full name only makes sense when first/last are not both present.
  const fullIdx = mapping.indexOf("full_name");
  if (fullIdx >= 0 && used.has("first_name") && used.has("last_name")) mapping[fullIdx] = "ignore";

  // Everything else with a header becomes a custom field.
  return mapping.map((target, i) => {
    if (target !== "ignore") return target;
    const header = headers[i] ?? "";
    if (!header.trim()) return "ignore";
    let key = customKey(header);
    for (let n = 2; usedCustom.has(key); n++) key = `${customKey(header)}_${n}`;
    usedCustom.add(key);
    return `custom:${key}` as const;
  });
}

export function validateMapping(mapping: ColumnMapping, columnCount: number): string | null {
  if (mapping.length !== columnCount) return "Mapping does not match the number of columns.";
  const fields = mapping.filter((m): m is LeadField => (LEAD_FIELDS as readonly string[]).includes(m));
  if (!fields.includes("email")) return "Map one column to Email.";
  const dup = fields.find((f, i) => fields.indexOf(f) !== i);
  if (dup) return `"${LEAD_FIELD_LABELS[dup]}" is mapped to more than one column.`;
  const customs = mapping.filter((m) => m.startsWith("custom:"));
  for (const c of customs) {
    if (!/^custom:[a-z0-9_]{1,64}$/.test(c)) return `Invalid custom field name: ${c.slice(7)}`;
  }
  const dupCustom = customs.find((c, i) => customs.indexOf(c) !== i);
  if (dupCustom) return `Custom field "${dupCustom.slice(7)}" is used twice.`;
  for (const m of mapping) {
    if (m !== "ignore" && !m.startsWith("custom:") && !(LEAD_FIELDS as readonly string[]).includes(m)) {
      return `Unknown target: ${m}`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Row preparation
// ---------------------------------------------------------------------------

/** Accepts "a@b.com", "mailto:a@b.com", "Ada <a@b.com>". Returns normalized email or null. */
export function extractEmail(raw: string): string | null {
  let v = raw.trim();
  const angle = /<([^<>]+)>/.exec(v);
  if (angle) v = angle[1]!;
  v = v.replace(/^mailto:/i, "").trim();
  return isValidEmailSyntax(v) ? normalizeEmail(v) : null;
}

export type PreparedLead = {
  /** 1-based line number in the original file (header = line 1). */
  row: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  title: string | null;
  custom: Record<string, string>;
};

export type RejectReason =
  | "missing_email"
  | "invalid_email"
  | "duplicate_in_file"
  | "already_exists"
  | "suppressed";

export const REJECT_REASON_LABELS: Record<RejectReason, string> = {
  missing_email: "Missing email",
  invalid_email: "Invalid email address",
  duplicate_in_file: "Duplicate of an earlier row in this file",
  already_exists: "Lead already exists (skipped)",
  suppressed: "On suppression list",
};

export type Rejection = { row: number; reason: RejectReason };

export type PreparedImport = { leads: PreparedLead[]; rejected: Rejection[]; totalRows: number };

function cell(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  return t ? t.slice(0, MAX_FIELD_LENGTH) : null;
}

export function prepareRows(rows: string[][], mapping: ColumnMapping): PreparedImport {
  const leads: PreparedLead[] = [];
  const rejected: Rejection[] = [];
  const seen = new Set<string>();
  const emailIdx = mapping.indexOf("email");

  rows.forEach((r, i) => {
    const row = i + 2;
    const rawEmail = cell(r[emailIdx]);
    if (!rawEmail) return void rejected.push({ row, reason: "missing_email" });
    const email = extractEmail(rawEmail);
    if (!email) return void rejected.push({ row, reason: "invalid_email" });
    if (seen.has(email)) return void rejected.push({ row, reason: "duplicate_in_file" });
    seen.add(email);

    const lead: PreparedLead = { row, email, first_name: null, last_name: null, company: null, title: null, custom: {} };
    let fullName: string | null = null;
    mapping.forEach((target, col) => {
      const value = cell(r[col]);
      if (value === null || target === "ignore" || target === "email") return;
      if (target === "full_name") fullName = value;
      else if (target.startsWith("custom:")) lead.custom[target.slice(7)] = value;
      else lead[target as "first_name" | "last_name" | "company" | "title"] = value;
    });
    if (fullName) {
      const [first, ...rest] = (fullName as string).split(/\s+/);
      lead.first_name ??= first ?? null;
      lead.last_name ??= rest.length ? rest.join(" ") : null;
    }
    leads.push(lead);
  });

  return { leads, rejected, totalRows: rows.length };
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// Error report
// ---------------------------------------------------------------------------

/** CSV of every row that was not imported: line, reason, then the original columns. */
export function buildErrorCsv(parsed: ParsedCsv, rejections: Rejection[]): string {
  const sorted = [...rejections].sort((a, b) => a.row - b.row);
  const data = sorted.map((r) => [String(r.row), REJECT_REASON_LABELS[r.reason], ...(parsed.rows[r.row - 2] ?? [])]);
  return Papa.unparse({ fields: ["line", "reason", ...parsed.headers], data }, { escapeFormulae: true });
}

export type ImportSummary = {
  total: number;
  imported: number;
  existing: number;
  suppressed: number;
  invalid: number;
  duplicates: number;
};

export function summarize(rejections: Rejection[], imported: number, existing: number, total: number): ImportSummary {
  const count = (reason: RejectReason) => rejections.filter((r) => r.reason === reason).length;
  return {
    total,
    imported,
    existing,
    suppressed: count("suppressed"),
    invalid: count("missing_email") + count("invalid_email"),
    duplicates: count("duplicate_in_file"),
  };
}

import { describe, expect, it } from "vitest";
import {
  buildErrorCsv,
  chunk,
  customKey,
  detectColumnMapping,
  extractEmail,
  parseCsv,
  prepareRows,
  summarize,
  validateMapping,
} from "./imports";

describe("parseCsv", () => {
  it("handles BOM, quotes, embedded commas/newlines and blank lines", () => {
    const csv = '﻿Email,Name,Notes\r\nada@x.io,"Lovelace, Ada","line1\nline2"\r\n\r\n,,\r\ngrace@x.io,Grace,\r\n';
    const { headers, rows } = parseCsv(csv);
    expect(headers).toEqual(["Email", "Name", "Notes"]);
    expect(rows).toEqual([
      ["ada@x.io", "Lovelace, Ada", "line1\nline2"],
      ["grace@x.io", "Grace", ""],
    ]);
  });

  it("auto-detects semicolon delimiters", () => {
    expect(parseCsv("email;company\na@b.io;Acme").rows).toEqual([["a@b.io", "Acme"]]);
  });
});

describe("detectColumnMapping", () => {
  it("maps common header variants and turns the rest into custom fields", () => {
    expect(
      detectColumnMapping(["E-mail Address", "First Name", "Surname", "Company Name", "Job Title", "LinkedIn URL", ""]),
    ).toEqual(["email", "first_name", "last_name", "company", "title", "custom:linkedin_url", "ignore"]);
  });

  it("uses full name only when first/last are not both present", () => {
    expect(detectColumnMapping(["Name", "Email"])).toEqual(["full_name", "email"]);
    expect(detectColumnMapping(["Name", "First", "Last", "Email"])).toEqual(["custom:name", "first_name", "last_name", "email"]);
  });

  it("finds the email column from sample values when headers don't say", () => {
    expect(detectColumnMapping(["Contact", "Col B"], [["Ada", "ada@x.io"], ["Grace", "grace@x.io"]])).toEqual([
      "full_name",
      "email",
    ]);
  });

  it("never maps a field twice and de-duplicates custom keys", () => {
    expect(detectColumnMapping(["email", "Email", "Tag", "tag"])).toEqual(["email", "custom:email", "custom:tag", "custom:tag_2"]);
  });
});

describe("validateMapping", () => {
  it("requires exactly one email column and unique fields", () => {
    expect(validateMapping(["email", "company"], 2)).toBeNull();
    expect(validateMapping(["company"], 1)).toMatch(/Email/);
    expect(validateMapping(["email", "company", "company"], 3)).toMatch(/more than one/);
    expect(validateMapping(["email"], 2)).toMatch(/number of columns/);
    expect(validateMapping(["email", "custom:Bad Key" as `custom:${string}`], 2)).toMatch(/Invalid custom/);
    expect(validateMapping(["email", "nope" as "ignore"], 2)).toMatch(/Unknown/);
  });
});

describe("extractEmail", () => {
  it.each([
    ["Ada@X.io", "ada@x.io"],
    ["  mailto:ada@x.io ", "ada@x.io"],
    ["Ada Lovelace <Ada@X.io>", "ada@x.io"],
    ["not an email", null],
    ["ada@x", null],
  ])("%s → %s", (input, expected) => expect(extractEmail(input)).toBe(expected));
});

describe("prepareRows", () => {
  const mapping = detectColumnMapping(["email", "name", "company", "Plan"]);

  it("validates, normalizes, splits names and de-dupes within the file (first wins)", () => {
    const { leads, rejected, totalRows } = prepareRows(
      [
        ["Ada@X.io", "Ada King Lovelace", " Analytical ", "pro"],
        ["", "No Email", "", ""],
        ["bogus", "Bad", "", ""],
        ["ada@x.io", "Dup", "", ""],
        ["grace@x.io", "", "", ""],
      ],
      mapping,
    );
    expect(totalRows).toBe(5);
    expect(leads).toEqual([
      { row: 2, email: "ada@x.io", first_name: "Ada", last_name: "King Lovelace", company: "Analytical", title: null, custom: { plan: "pro" } },
      { row: 6, email: "grace@x.io", first_name: null, last_name: null, company: null, title: null, custom: {} },
    ]);
    expect(rejected).toEqual([
      { row: 3, reason: "missing_email" },
      { row: 4, reason: "invalid_email" },
      { row: 5, reason: "duplicate_in_file" },
    ]);
  });

  it("truncates oversized values", () => {
    const { leads } = prepareRows([["a@b.io", "x".repeat(2000), "", ""]], mapping);
    expect(leads[0]!.first_name!.length).toBe(500);
  });

  it("is deterministic (safe to recompute per chunk)", () => {
    const rows = [["a@b.io", "A", "", ""], ["A@B.io", "B", "", ""]];
    expect(prepareRows(rows, mapping)).toEqual(prepareRows(rows, mapping));
  });
});

describe("buildErrorCsv", () => {
  it("lists rejected rows with reason and original values, and neutralizes formulas", () => {
    const parsed = parseCsv("email,company\nbad,=HYPERLINK(\"x\")\nok@x.io,Acme\n");
    const csv = buildErrorCsv(parsed, [{ row: 2, reason: "invalid_email" }]);
    const lines = csv.split(/\r?\n/);
    expect(lines[0]).toBe("line,reason,email,company");
    expect(lines[1]).toContain("Invalid email address");
    expect(lines[1]).toContain("'=HYPERLINK");
    expect(lines).toHaveLength(2);
  });
});

describe("summarize / chunk / customKey", () => {
  it("summarizes rejections", () => {
    expect(
      summarize(
        [
          { row: 2, reason: "invalid_email" },
          { row: 3, reason: "missing_email" },
          { row: 4, reason: "duplicate_in_file" },
          { row: 5, reason: "suppressed" },
        ],
        10,
        3,
        17,
      ),
    ).toEqual({ total: 17, imported: 10, existing: 3, suppressed: 1, invalid: 2, duplicates: 1 });
  });

  it("chunks", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("slugs custom keys", () => {
    expect(customKey("  LinkedIn URL! ")).toBe("linkedin_url");
    expect(customKey("!!!")).toBe("field");
  });
});

import { isExcelFile, isSpreadsheetFile, parseCsv, sheetToParsed, type ParsedCsv } from "@crm/core/imports";

/**
 * Reads a CSV/TSV/TXT or Excel (.xlsx) file in the browser into rows. Excel
 * support loads on demand, so pages that never import don't download it.
 * Google Sheets: File → Download → .xlsx or .csv.
 */
export async function readSpreadsheetFile(file: File): Promise<ParsedCsv> {
  if (!isSpreadsheetFile(file.name)) {
    throw new Error(/\.xls$/i.test(file.name) ? "Old .xls files aren't supported: open it and save as .xlsx or .csv." : "Choose a .csv or .xlsx file.");
  }
  if (isExcelFile(file.name)) {
    const { readSheet } = await import("read-excel-file/browser");
    try {
      return sheetToParsed(await readSheet(file));
    } catch {
      throw new Error("Couldn't read that Excel file. Try saving it again as .xlsx or .csv.");
    }
  }
  return parseCsv(await file.text());
}

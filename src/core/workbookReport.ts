import { cellIndex, readCell, ROW_STATUS, type CellCode, type CellView, type PackedGrid, type PackedWorkbook, type PackedWorkbookDiff } from "./pack";
import type { DiffCounts, DiffOptions, RowStatus, SheetStatus } from "./types";

/** Maximum individual changes recorded per sheet in a saved compact report to keep memory & storage bounded. */
export const MAX_REPORT_CHANGES_PER_SHEET = 5_000;

type Dimensions = [rows: number, columns: number];

export interface ReportSheetSummary {
  originalName: string | null;
  modifiedName: string | null;
  originalSize: Dimensions | null;
  modifiedSize: Dimensions | null;
  comparedRows: number;
  status: SheetStatus;
  identical: boolean;
  counts: DiffCounts;
  mergesAdded?: string[];
  mergesRemoved?: string[];
}

export interface WorkbookReportSummary {
  originalName: string;
  modifiedName: string;
  identical: boolean;
  sheetOrderChanged: boolean;
  options: DiffOptions;
  sheets: ReportSheetSummary[];
  totals: PackedWorkbookDiff["totals"];
}

export type ReportChange =
  | { originalRow: number; modifiedRow: number; status: RowStatus }
  | { originalRow: number; modifiedRow: number; status: RowStatus; column: number; code: CellCode; original: CellView | null; modified: CellView | null };

export interface WorkbookReport extends WorkbookReportSummary {
  version: 1;
  /** Omitted when no sheet has row or cell changes. Indexed by sheet position. */
  changes?: Record<number, ReportChange[]>;
  /** Indexed by sheet position: total change entries when a sheet exceeded MAX_REPORT_CHANGES_PER_SHEET. */
  truncated?: Record<number, number>;
}

export function summarizeWorkbook(
  diff: PackedWorkbookDiff, original: PackedWorkbook, modified: PackedWorkbook, options: DiffOptions,
): WorkbookReportSummary {
  const dimensions = (grid: PackedGrid | undefined): Dimensions | null => grid ? [grid.rowCount, grid.colCount] : null;
  return {
    originalName: original.fileName,
    modifiedName: modified.fileName,
    identical: diff.identical,
    sheetOrderChanged: diff.sheetOrderChanged,
    options,
    totals: diff.totals,
    sheets: diff.sheets.map((sheet) => ({
      originalName: sheet.origName,
      modifiedName: sheet.modName,
      originalSize: dimensions(original.sheets[sheet.origIndex]?.grid),
      modifiedSize: dimensions(modified.sheets[sheet.modIndex]?.grid),
      comparedRows: sheet.rows.length,
      status: sheet.status,
      identical: sheet.identical,
      counts: sheet.counts,
      ...(sheet.mergesAdded.length ? { mergesAdded: sheet.mergesAdded } : {}),
      ...(sheet.mergesRemoved.length ? { mergesRemoved: sheet.mergesRemoved } : {}),
    })),
  };
}

function reportCell(grid: PackedGrid | undefined, row: number, column: number): CellView | null {
  if (!grid) return null;
  const index = cellIndex(grid, row, column);
  return index < 0 ? null : readCell(grid, index);
}

export function captureWorkbookReport(
  diff: PackedWorkbookDiff,
  original: PackedWorkbook,
  modified: PackedWorkbook,
  options: DiffOptions,
  changeLimit = MAX_REPORT_CHANGES_PER_SHEET,
): WorkbookReport {
  const report: WorkbookReport = { version: 1, ...summarizeWorkbook(diff, original, modified, options) };
  if (diff.identical) return report;

  diff.sheets.forEach((sheet, index) => {
    if (sheet.identical) return;
    const left = original.sheets[sheet.origIndex]?.grid;
    const right = modified.sheets[sheet.modIndex]?.grid;
    const changes: ReportChange[] = [];
    let totalEntries = 0;
    const rows = sheet.rows;
    for (let row = 0; row < rows.length; row++) {
      const status = ROW_STATUS[rows.status[row]!]!;
      if (status === "same") continue;
      const originalRow = rows.orig[row]!;
      const modifiedRow = rows.mod[row]!;
      const start = rows.cellPtr[row]!;
      const end = rows.cellPtr[row + 1]!;
      if (start === end) {
        totalEntries++;
        if (changes.length < changeLimit) changes.push({ originalRow, modifiedRow, status });
      }
      for (let cell = start; cell < end; cell++) {
        totalEntries++;
        if (changes.length < changeLimit) {
          const column = rows.cellCol[cell]!;
          changes.push({
            originalRow,
            modifiedRow,
            status,
            column,
            code: rows.cellCode[cell]! as CellCode,
            original: reportCell(left, originalRow, column),
            modified: reportCell(right, modifiedRow, column),
          });
        }
      }
    }
    if (changes.length) (report.changes ??= {})[index] = changes;
    if (totalEntries > changes.length) (report.truncated ??= {})[index] = totalEntries;
  });
  return report;
}

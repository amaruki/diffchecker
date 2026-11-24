import { CellCode, type CellView } from "../core/pack";
import type { DiffCounts, DiffOptions, RowStatus, SheetStatus } from "../core/types";
import type { ReportChange, ReportSheetSummary, WorkbookReport } from "../core/workbookReport";
import { MAX_COLUMN_INDEX } from "../ui/columns";

export interface EncodedReport {
  encoding: "json" | "gzip";
  payload: Blob;
}

export const MAX_REPORT_BYTES = 50 * 1024 * 1024;
const MAX_REPORT_SHEETS = 1_000;
const ARRAY_INDEX_RE = /^(0|[1-9]\d*)$/;

const ROW_STATUSES = new Set<RowStatus>(["same", "added", "removed", "changed"]);
const SHEET_STATUSES = new Set<SheetStatus>(["matched", "added", "removed", "renamed"]);
const CELL_TYPES = new Set<CellView["type"]>(["s", "n", "b", "d", "e"]);
const CELL_CODES = new Set<number>([
  CellCode.None,
  CellCode.Added,
  CellCode.Removed,
  CellCode.ChangedValue,
  CellCode.ChangedFormula,
  CellCode.ChangedBoth,
]);

type RecordValue = Record<string, unknown>;

export function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRowIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= -1;
}

function isDimensions(value: unknown): value is [number, number] | null {
  return value === null || (Array.isArray(value) && value.length === 2 && isNonNegInt(value[0]) && isNonNegInt(value[1]));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export function isDiffOptions(value: unknown): value is DiffOptions {
  if (!isRecord(value)) return false;
  return (
    (value.rowMatching === "aligned" || value.rowMatching === "index" || value.rowMatching === "key") &&
    isNonNegInt(value.keyColumn) &&
    value.keyColumn <= MAX_COLUMN_INDEX &&
    (value.compareMode === "values" || value.compareMode === "formulas") &&
    typeof value.ignoreCase === "boolean" &&
    typeof value.trimWhitespace === "boolean" &&
    typeof value.ignoreEmpty === "boolean"
  );
}

export function sanitizeDiffOptions(options: DiffOptions): DiffOptions {
  return {
    rowMatching: options.rowMatching,
    keyColumn: options.keyColumn,
    compareMode: options.compareMode,
    ignoreCase: options.ignoreCase,
    trimWhitespace: options.trimWhitespace,
    ignoreEmpty: options.ignoreEmpty,
  };
}

function isDiffCounts(value: unknown): value is DiffCounts {
  if (!isRecord(value)) return false;
  return (
    isNonNegInt(value.addedRows) &&
    isNonNegInt(value.removedRows) &&
    isNonNegInt(value.changedRows) &&
    isNonNegInt(value.addedCells) &&
    isNonNegInt(value.removedCells) &&
    isNonNegInt(value.changedCells) &&
    isNonNegInt(value.mergeChanges)
  );
}

function isSheetSummary(value: unknown): value is ReportSheetSummary {
  if (!isRecord(value)) return false;
  return (
    (value.originalName === null || typeof value.originalName === "string") &&
    (value.modifiedName === null || typeof value.modifiedName === "string") &&
    isDimensions(value.originalSize) &&
    isDimensions(value.modifiedSize) &&
    isNonNegInt(value.comparedRows) &&
    typeof value.status === "string" &&
    SHEET_STATUSES.has(value.status as SheetStatus) &&
    typeof value.identical === "boolean" &&
    isDiffCounts(value.counts) &&
    (value.mergesAdded === undefined || isStringArray(value.mergesAdded)) &&
    (value.mergesRemoved === undefined || isStringArray(value.mergesRemoved))
  );
}

function isCellView(value: unknown): value is CellView | null {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  return (
    typeof value.type === "string" &&
    CELL_TYPES.has(value.type as CellView["type"]) &&
    typeof value.text === "string" &&
    typeof value.raw === "string" &&
    (value.formula === null || typeof value.formula === "string")
  );
}

function isReportChange(value: unknown): value is ReportChange {
  if (!isRecord(value)) return false;
  if (!isRowIndex(value.originalRow) || !isRowIndex(value.modifiedRow)) return false;
  if (typeof value.status !== "string" || !ROW_STATUSES.has(value.status as RowStatus)) return false;
  if (!Object.hasOwn(value, "column")) return true;
  return (
    isNonNegInt(value.column) &&
    value.column <= MAX_COLUMN_INDEX &&
    typeof value.code === "number" &&
    CELL_CODES.has(value.code) &&
    isCellView(value.original) &&
    isCellView(value.modified)
  );
}

export function isValidWorkbookReport(value: unknown): value is WorkbookReport {
  if (!isRecord(value)) return false;
  if (value.version !== 1) return false;
  if (typeof value.originalName !== "string" || typeof value.modifiedName !== "string") return false;
  if (typeof value.identical !== "boolean" || typeof value.sheetOrderChanged !== "boolean") return false;
  if (!isDiffOptions(value.options)) return false;
  if (!isRecord(value.totals) || !isDiffCounts(value.totals)) return false;
  if (
    !isNonNegInt(value.totals.addedSheets) ||
    !isNonNegInt(value.totals.removedSheets) ||
    !isNonNegInt(value.totals.renamedSheets)
  ) {
    return false;
  }
  if (!Array.isArray(value.sheets) || value.sheets.length > MAX_REPORT_SHEETS || !value.sheets.every(isSheetSummary)) {
    return false;
  }
  const sheetCount = value.sheets.length;
  if (value.changes !== undefined) {
    if (!isRecord(value.changes)) return false;
    for (const key of Object.keys(value.changes)) {
      if (!ARRAY_INDEX_RE.test(key) || Number(key) >= sheetCount) return false;
      const list = value.changes[key];
      if (!Array.isArray(list) || !list.every(isReportChange)) return false;
    }
  }
  if (value.truncated !== undefined) {
    if (!isRecord(value.truncated)) return false;
    for (const key of Object.keys(value.truncated)) {
      if (!ARRAY_INDEX_RE.test(key) || Number(key) >= sheetCount) return false;
      const total = value.truncated[key];
      if (!isNonNegInt(total) || total === 0) return false;
    }
  }
  return true;
}

/** Stream-read a byte stream while enforcing a strict byte ceiling (prevents gzip bombs from exhausting RAM). */
async function readBoundedText(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8");
  const chunks: string[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error("This saved workbook result exceeds the safe size limit.");
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    reader.releaseLock();
  }
}

export async function encodeWorkbookReport(report: WorkbookReport): Promise<EncodedReport> {
  const json = new Blob([JSON.stringify(report)], { type: "application/json" });
  if (json.size > MAX_REPORT_BYTES) {
    throw new Error("This workbook report is too large to save in browser storage.");
  }
  if (typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined") {
    const gzip = await new Response(json.stream().pipeThrough(new CompressionStream("gzip"))).blob();
    if (gzip.size < json.size) return { encoding: "gzip", payload: gzip };
  }
  return { encoding: "json", payload: json };
}

export async function decodeWorkbookReport(
  { encoding, payload }: EncodedReport,
  maxBytes = MAX_REPORT_BYTES,
): Promise<WorkbookReport> {
  if (encoding !== "json" && encoding !== "gzip") {
    throw new Error("This saved workbook result uses an unsupported encoding.");
  }
  if (!(payload instanceof Blob)) {
    throw new Error("This saved workbook result is corrupted.");
  }
  let text: string;
  if (encoding === "json") {
    if (payload.size > maxBytes) {
      throw new Error("This saved workbook result exceeds the safe size limit.");
    }
    text = await payload.text();
  } else {
    try {
      const decompressed = payload.stream().pipeThrough(new DecompressionStream("gzip"));
      text = await readBoundedText(decompressed, maxBytes);
    } catch (error) {
      if (error instanceof Error && /safe size limit/i.test(error.message)) throw error;
      throw new Error("This saved workbook result could not be decompressed.", { cause: error });
    }
  }
  let report: unknown;
  try {
    report = JSON.parse(text);
  } catch (error) {
    throw new Error("This saved workbook result is unreadable.", { cause: error });
  }
  if (!isValidWorkbookReport(report)) {
    throw new Error("This saved workbook result uses an unsupported or corrupted format.");
  }
  return report;
}

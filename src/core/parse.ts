import { read, utils, type CellObject, type WorkBook, type WorkSheet } from "xlsx";
import { forEachPresent } from "./sparse";
import type { Cell, Row, SheetData, WorkbookData } from "./types";

/** Thrown for any file the app cannot read. `message` is shown to the user as is. */
export class WorkbookParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkbookParseError";
  }
}

/** Files above this size are rejected before parsing to protect browser memory. */
export const MAX_WORKBOOK_BYTES = 100 * 1024 * 1024;
/** Maximum total uncompressed ZIP bytes allowed before SheetJS inflates the archive. */
export const MAX_UNCOMPRESSED_BYTES = 350 * 1024 * 1024;
/** Maximum ZIP archive entry count allowed. */
export const MAX_ZIP_ENTRIES = 10_000;
/** Maximum non-empty cells allowed across all sheets in a single workbook. */
export const MAX_WORKBOOK_CELLS = 2_000_000;
/** Maximum total rows allocated across all sheets combined (guards multi-sheet sparse row bombs). */
export const MAX_WORKBOOK_ROWS = 2_000_000;
/** Excel's maximum row count; guards against malformed sparse-row metadata. */
export const MAX_SHEET_ROWS = 1_048_576;
/** Excel's maximum column count (A..XFD). */
export const MAX_SHEET_COLS = 16_384;

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
/** OLE compound file: legacy .xls, or an encrypted .xlsx. */
const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0];
const ACCEPTED_BOOK_TYPES = new Set(["xlsx", "xlsm"]);

const EOCD_SIG = 0x06054b50;
const CD_HEADER_SIG = 0x02014b50;
const ZIP64_EXTRA_ID = 0x0001;

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  return magic.every((b, i) => bytes[i] === b);
}

/**
 * Inspect the ZIP Central Directory before SheetJS inflates the archive.
 * Rejects ZIP decompression bombs, excessive entry counts, and non-OOXML ZIPs fast.
 */
function validateZipCentralDirectory(bytes: Uint8Array): void {
  const len = bytes.length;
  if (len < 22) {
    throw new WorkbookParseError("The file is corrupted or truncated and is not a valid .xlsx workbook.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minEocd = Math.max(0, len - 65_557);
  let eocdOffset = -1;
  for (let i = len - 22; i >= minEocd; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      const commentLen = view.getUint16(i + 20, true);
      if (i + 22 + commentLen === len) {
        eocdOffset = i;
        break;
      }
    }
  }
  if (eocdOffset < 0) {
    throw new WorkbookParseError("The file is corrupted or truncated (ZIP directory not found).");
  }

  let entryCount = view.getUint16(eocdOffset + 10, true);
  let cdSize = view.getUint32(eocdOffset + 12, true);
  let cdOffset = view.getUint32(eocdOffset + 16, true);

  // If ZIP64 sentinel values are present, read the ZIP64 EOCD locator/record when available.
  if (entryCount === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    if (eocdOffset < 20 || view.getUint32(eocdOffset - 20, true) !== 0x07064b50) {
      throw new WorkbookParseError("The file is corrupted or uses an unsupported ZIP64 archive layout.");
    }
    const z64Offset = Number(view.getBigUint64(eocdOffset - 12, true));
    if (!Number.isSafeInteger(z64Offset) || z64Offset < 0 || z64Offset + 56 > len || view.getUint32(z64Offset, true) !== 0x06064b50) {
      throw new WorkbookParseError("The file is corrupted or uses an unsupported ZIP64 archive layout.");
    }
    const z64Entries = Number(view.getBigUint64(z64Offset + 32, true));
    const z64CdSize = Number(view.getBigUint64(z64Offset + 40, true));
    const z64CdOffset = Number(view.getBigUint64(z64Offset + 48, true));
    if (entryCount === 0xffff) entryCount = z64Entries;
    if (cdSize === 0xffffffff) cdSize = z64CdSize;
    if (cdOffset === 0xffffffff) cdOffset = z64CdOffset;
  }

  if (!Number.isSafeInteger(entryCount) || entryCount > MAX_ZIP_ENTRIES) {
    throw new WorkbookParseError(`This archive contains too many entries (limit is ${MAX_ZIP_ENTRIES.toLocaleString()}).`);
  }
  if (!Number.isSafeInteger(cdOffset) || !Number.isSafeInteger(cdSize) || cdOffset < 0 || cdOffset + cdSize > len) {
    throw new WorkbookParseError("The file is corrupted or truncated (invalid ZIP directory bounds).");
  }

  const decoder = new TextDecoder("utf-8");
  let pos = cdOffset;
  const cdEnd = cdOffset + cdSize;
  let totalUncompressed = 0;
  let hasContentTypes = false;
  let seen = 0;

  while (pos + 46 <= cdEnd && seen < entryCount) {
    if (view.getUint32(pos, true) !== CD_HEADER_SIG) {
      throw new WorkbookParseError("The file is corrupted (invalid ZIP entry header).");
    }
    const compSize32 = view.getUint32(pos + 20, true);
    let uncompSize = view.getUint32(pos + 24, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const nextPos = pos + 46 + nameLen + extraLen + commentLen;
    if (nextPos > cdEnd) {
      throw new WorkbookParseError("The file is corrupted or truncated (ZIP entry exceeds directory).");
    }

    if (uncompSize === 0xffffffff) {
      // Parse ZIP64 extra field to read true 64-bit uncompressed size.
      let ex = pos + 46 + nameLen;
      const exEnd = ex + extraLen;
      let resolved = false;
      while (ex + 4 <= exEnd) {
        const id = view.getUint16(ex, true);
        const sz = view.getUint16(ex + 2, true);
        if (id === ZIP64_EXTRA_ID && ex + 4 + sz <= exEnd && sz >= 8) {
          uncompSize = Number(view.getBigUint64(ex + 4, true));
          resolved = true;
          break;
        }
        ex += 4 + sz;
      }
      if (!resolved || !Number.isSafeInteger(uncompSize)) {
        throw new WorkbookParseError("The workbook exceeds the safe uncompressed size limit.");
      }
    }

    // Also guard against a forged 0 uncompressed size with a non-zero compressed payload.
    totalUncompressed += Math.max(uncompSize, compSize32);
    if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) {
      throw new WorkbookParseError(
        `This workbook expands beyond the ${MAX_UNCOMPRESSED_BYTES / 1024 / 1024} MB browser safety limit.`,
      );
    }

    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
    if (name === "[Content_Types].xml") hasContentTypes = true;
    pos = nextPos;
    seen++;
  }

  if (seen === 0) {
    throw new WorkbookParseError("The archive is empty and is not a valid .xlsx workbook.");
  }
  if (!hasContentTypes) {
    throw new WorkbookParseError("This ZIP archive is not a valid .xlsx workbook (missing [Content_Types].xml).");
  }
}

/** Reject non-XLSX, oversized, or ZIP-bomb input before SheetJS sees it. */
function validateContainer(bytes: Uint8Array): void {
  if (bytes.length === 0) throw new WorkbookParseError("The file is empty.");
  if (bytes.length > MAX_WORKBOOK_BYTES) {
    throw new WorkbookParseError(
      `The file is ${(bytes.length / 1024 / 1024).toFixed(0)} MB. The limit is ${MAX_WORKBOOK_BYTES / 1024 / 1024} MB.`,
    );
  }
  if (startsWith(bytes, CFB_MAGIC)) {
    throw new WorkbookParseError(
      "This file is a legacy .xls workbook or a password-protected .xlsx. Save it as an unencrypted .xlsx and try again.",
    );
  }
  if (!startsWith(bytes, ZIP_MAGIC)) {
    throw new WorkbookParseError("This is not an .xlsx file. An .xlsx file is a ZIP archive, and this file is not one.");
  }
  validateZipCentralDirectory(bytes);
}

function toCell(c: CellObject): Cell | undefined {
  const formula = typeof c.f === "string" && c.f !== "" ? c.f : undefined;
  if (c.t === "z" && formula === undefined) return undefined;
  const text = c.w ?? (c.v === undefined ? "" : utils.format_cell(c));
  const base = formula === undefined ? {} : { formula };
  switch (c.t) {
    case "n":
      return { type: "n", value: Number(c.v), text, ...base };
    case "b":
      return { type: "b", value: Boolean(c.v), text, ...base };
    case "d": {
      const value = c.v instanceof Date && !Number.isNaN(c.v.getTime()) ? c.v.toISOString() : (text || String(c.v));
      return { type: "d", value, text, ...base };
    }
    case "e":
      return { type: "e", value: text, text, ...base };
    default:
      // "s", or a formula cell without a cached value ("z").
      return { type: "s", value: c.v === undefined ? "" : String(c.v), text, ...base };
  }
}

function rowHasCells(src: CellObject[] | undefined): boolean {
  if (!src) return false;
  let found = false;
  forEachPresent(src, (cellObj) => {
    if (found) return;
    if (cellObj.t !== "z" || (typeof cellObj.f === "string" && cellObj.f !== "")) found = true;
  });
  return found;
}

function toSheetData(name: string, ws: WorkSheet | undefined, budget: { cells: number; rows: number }): SheetData {
  const data = ws?.["!data"];
  const rows: Row[] = [];
  let colCount = 0;
  if (data) {
    // Check sparsely for populated rows beyond MAX_SHEET_ROWS so none are silently truncated.
    let lastRow = -1;
    forEachPresent(data, (src, r) => {
      if (!rowHasCells(src)) return;
      if (r >= MAX_SHEET_ROWS) {
        throw new WorkbookParseError(`Sheet "${name}" exceeds the ${MAX_SHEET_ROWS.toLocaleString()}-row limit.`);
      }
      if (r > lastRow) lastRow = r;
    });

    const rowCount = lastRow + 1;
    if (budget.rows + rowCount > MAX_WORKBOOK_ROWS) {
      throw new WorkbookParseError(
        `This workbook exceeds the ${MAX_WORKBOOK_ROWS.toLocaleString()}-row browser safety limit.`,
      );
    }
    budget.rows += rowCount;

    for (let r = 0; r <= lastRow; r++) {
      const src = data[r];
      const row: Row = [];
      if (src) {
        forEachPresent(src, (cellObj, c) => {
          if (c >= MAX_SHEET_COLS) {
            throw new WorkbookParseError(`Sheet "${name}" exceeds the ${MAX_SHEET_COLS.toLocaleString()}-column limit.`);
          }
          const cell = toCell(cellObj);
          if (cell) {
            if (++budget.cells > MAX_WORKBOOK_CELLS) {
              throw new WorkbookParseError(
                `This workbook exceeds the ${MAX_WORKBOOK_CELLS.toLocaleString()}-cell browser safety limit.`,
              );
            }
            row[c] = cell;
            if (c + 1 > colCount) colCount = c + 1;
          }
        });
      }
      rows.push(row);
    }
  }
  const merges = (ws?.["!merges"] ?? []).map((m) => utils.encode_range(m)).sort();
  return { name, rows, colCount, merges };
}

export function parseWorkbook(buffer: ArrayBuffer, fileName: string): WorkbookData {
  const bytes = new Uint8Array(buffer);
  validateContainer(bytes);
  let wb: WorkBook;
  try {
    wb = read(bytes, {
      type: "array",
      dense: true,
      cellDates: true,
      cellFormula: true,
      cellHTML: false,
      cellStyles: false,
      cellNF: false,
      sheetStubs: false,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new WorkbookParseError(`The file is corrupted or is not a valid .xlsx workbook (${detail}).`);
  }
  if (wb.bookType !== undefined && !ACCEPTED_BOOK_TYPES.has(wb.bookType)) {
    throw new WorkbookParseError(`Unsupported format "${wb.bookType}". Only .xlsx and .xlsm files are supported.`);
  }
  if (wb.SheetNames.length === 0) throw new WorkbookParseError("The workbook contains no sheets.");
  const budget = { cells: 0, rows: 0 };
  return {
    fileName,
    sheets: wb.SheetNames.map((name) => toSheetData(name, wb.Sheets[name], budget)),
  };
}

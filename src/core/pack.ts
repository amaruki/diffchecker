/**
 * Compact, transferable encodings of parsed sheets and diff results.
 *
 * Why: structuredClone of 600k cell objects (50k rows × 12 cols) costs ~2 s in V8,
 * and half of that lands on the main thread. These encodings use typed arrays
 * (transferred, zero-copy) plus one concatenated string per field, so the
 * main thread receives a 50k-row sheet in milliseconds.
 *
 * Layout is CSR (compressed sparse row): cells of row r occupy indexes
 * rowPtr[r] .. rowPtr[r+1]-1, sorted by column.
 */
import { forEachPresent } from "./sparse";
import type { AlignedRow, CellStatus, CellType, ChangeKind, RowStatus, SheetData, SheetDiff, WorkbookData, WorkbookDiff } from "./types";

/* ------------------------------------------------------------------- grids */

export interface PackedGrid {
  rowCount: number;
  colCount: number;
  rowPtr: Int32Array;
  cols: Int32Array;
  types: Uint8Array;
  /** End offset of each cell's display text in `text`; the start is the previous end (or 0). */
  textEnd: Int32Array;
  text: string;
  rawEnd: Int32Array;
  raw: string;
  /** Empty slice = no formula. */
  formulaEnd: Int32Array;
  formula: string;
}

export interface PackedSheet {
  name: string;
  merges: string[];
  grid: PackedGrid;
}

export interface PackedWorkbook {
  fileName: string;
  sheets: PackedSheet[];
}

const TYPE_CODES: readonly CellType[] = ["s", "n", "b", "d", "e"];

export function packSheet(sheet: SheetData): PackedSheet {
  let nCells = 0;
  for (const row of sheet.rows) {
    forEachPresent(row, () => {
      nCells++;
    });
  }
  const rowPtr = new Int32Array(sheet.rows.length + 1);
  const cols = new Int32Array(nCells);
  const types = new Uint8Array(nCells);
  const textEnd = new Int32Array(nCells);
  const rawEnd = new Int32Array(nCells);
  const formulaEnd = new Int32Array(nCells);
  const texts: string[] = [];
  const raws: string[] = [];
  const formulas: string[] = [];
  let k = 0;
  let tLen = 0;
  let rLen = 0;
  let fLen = 0;
  for (let r = 0; r < sheet.rows.length; r++) {
    rowPtr[r] = k;
    const row = sheet.rows[r]!;
    forEachPresent(row, (cell, c) => {
      const raw = String(cell.value);
      const formula = cell.formula ?? "";
      cols[k] = c;
      types[k] = TYPE_CODES.indexOf(cell.type);
      texts.push(cell.text);
      raws.push(raw);
      formulas.push(formula);
      tLen += cell.text.length;
      rLen += raw.length;
      fLen += formula.length;
      textEnd[k] = tLen;
      rawEnd[k] = rLen;
      formulaEnd[k] = fLen;
      k++;
    });
  }
  rowPtr[sheet.rows.length] = k;
  return {
    name: sheet.name,
    merges: sheet.merges,
    grid: {
      rowCount: sheet.rows.length,
      colCount: sheet.colCount,
      rowPtr,
      cols,
      types,
      textEnd,
      text: texts.join(""),
      rawEnd,
      raw: raws.join(""),
      formulaEnd,
      formula: formulas.join(""),
    },
  };
}

export function packWorkbook(wb: WorkbookData): PackedWorkbook {
  return { fileName: wb.fileName, sheets: wb.sheets.map(packSheet) };
}

/** Index of the cell at (row, col), or -1. Binary search within the row. */
export function cellIndex(grid: PackedGrid, row: number, col: number): number {
  if (row < 0 || row >= grid.rowCount) return -1;
  let lo = grid.rowPtr[row]!;
  let hi = grid.rowPtr[row + 1]! - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = grid.cols[mid]!;
    if (c === col) return mid;
    if (c < col) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

const slice = (s: string, ends: Int32Array, i: number): string => s.slice(i === 0 ? 0 : ends[i - 1]!, ends[i]!);

export interface CellView {
  type: CellType;
  text: string;
  raw: string;
  formula: string | null;
}

export function readCell(grid: PackedGrid, i: number): CellView {
  const formula = slice(grid.formula, grid.formulaEnd, i);
  return {
    type: TYPE_CODES[grid.types[i]!]!,
    text: slice(grid.text, grid.textEnd, i),
    raw: slice(grid.raw, grid.rawEnd, i),
    formula: formula === "" ? null : formula,
  };
}

export function cellText(grid: PackedGrid, i: number): string {
  return slice(grid.text, grid.textEnd, i);
}

export function cellFormula(grid: PackedGrid, i: number): string | null {
  const f = slice(grid.formula, grid.formulaEnd, i);
  return f === "" ? null : f;
}

/* ------------------------------------------------------------- diff result */

export const ROW_STATUS: readonly RowStatus[] = ["same", "added", "removed", "changed"];

/** 0 = no difference. Codes 3..5 are "changed" with the change kind. */
export const CellCode = {
  None: 0,
  Added: 1,
  Removed: 2,
  ChangedValue: 3,
  ChangedFormula: 4,
  ChangedBoth: 5,
} as const;
export type CellCode = (typeof CellCode)[keyof typeof CellCode];

function encodeCell(status: CellStatus, kind: ChangeKind | undefined): CellCode {
  if (status === "added") return CellCode.Added;
  if (status === "removed") return CellCode.Removed;
  if (kind === "formula") return CellCode.ChangedFormula;
  if (kind === "both") return CellCode.ChangedBoth;
  return CellCode.ChangedValue;
}

export interface PackedRows {
  length: number;
  orig: Int32Array;
  mod: Int32Array;
  /** Index into ROW_STATUS. */
  status: Uint8Array;
  cellPtr: Int32Array;
  cellCol: Int32Array;
  cellCode: Uint8Array;
}

export type PackedSheetDiff = Omit<SheetDiff, "rows"> & { rows: PackedRows };
export type PackedWorkbookDiff = Omit<WorkbookDiff, "sheets"> & { sheets: PackedSheetDiff[] };

export function packRows(rows: AlignedRow[]): PackedRows {
  let nCells = 0;
  for (const r of rows) nCells += r.cells?.length ?? 0;
  const out: PackedRows = {
    length: rows.length,
    orig: new Int32Array(rows.length),
    mod: new Int32Array(rows.length),
    status: new Uint8Array(rows.length),
    cellPtr: new Int32Array(rows.length + 1),
    cellCol: new Int32Array(nCells),
    cellCode: new Uint8Array(nCells),
  };
  let k = 0;
  rows.forEach((r, i) => {
    out.orig[i] = r.orig;
    out.mod[i] = r.mod;
    out.status[i] = ROW_STATUS.indexOf(r.status);
    out.cellPtr[i] = k;
    for (const c of r.cells ?? []) {
      out.cellCol[k] = c.col;
      out.cellCode[k] = encodeCell(c.status, c.kind);
      k++;
    }
  });
  out.cellPtr[rows.length] = k;
  return out;
}

export function packWorkbookDiff(diff: WorkbookDiff): PackedWorkbookDiff {
  return { ...diff, sheets: diff.sheets.map((s) => ({ ...s, rows: packRows(s.rows) })) };
}

/** Difference code of the cell at (aligned row, col). Rows hold few diff cells, so a scan is fine. */
export function cellCodeAt(rows: PackedRows, row: number, col: number): CellCode {
  const end = rows.cellPtr[row + 1]!;
  for (let k = rows.cellPtr[row]!; k < end; k++) {
    const c = rows.cellCol[k]!;
    if (c === col) return rows.cellCode[k]! as CellCode;
    if (c > col) break;
  }
  return CellCode.None;
}

/* ---------------------------------------------------------------- transfer */

function gridBuffers(g: PackedGrid): ArrayBuffer[] {
  return [g.rowPtr, g.cols, g.types, g.textEnd, g.rawEnd, g.formulaEnd].map((a) => a.buffer as ArrayBuffer);
}

export function workbookTransferables(wb: PackedWorkbook): ArrayBuffer[] {
  return wb.sheets.flatMap((s) => gridBuffers(s.grid));
}

export function diffTransferables(diff: PackedWorkbookDiff): ArrayBuffer[] {
  return diff.sheets.flatMap((s) =>
    [s.rows.orig, s.rows.mod, s.rows.status, s.rows.cellPtr, s.rows.cellCol, s.rows.cellCode].map(
      (a) => a.buffer as ArrayBuffer,
    ),
  );
}

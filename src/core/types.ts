/**
 * Data shapes shared by the parser, the diff engine, the worker and the UI.
 * Everything here must survive structuredClone (no classes, no functions, no Maps).
 */

/** s = string, n = number, b = boolean, d = date, e = error. */
export type CellType = "s" | "n" | "b" | "d" | "e";

export interface Cell {
  type: CellType;
  /** Raw value. Dates are ISO-8601 strings so they clone and compare cheaply. */
  value: string | number | boolean;
  /** Text as Excel would display it (number format applied). Used for rendering only. */
  text: string;
  /** Formula without the leading "=". Absent for constant cells. */
  formula?: string;
}

/** A row is a sparse array indexed by 0-based column. Holes mean "no cell". */
export type Row = Array<Cell | undefined>;

export interface SheetData {
  name: string;
  /** Indexed by 0-based row number (row 0 = Excel row 1). */
  rows: Row[];
  /** Number of columns in the used range (max column index + 1). */
  colCount: number;
  /** Merged ranges in A1 notation, e.g. "A1:C1". Sorted. */
  merges: string[];
}

export interface WorkbookData {
  fileName: string;
  sheets: SheetData[];
}

/* ------------------------------------------------------------------ options */

/**
 * aligned = keep row order, detect inserted/deleted rows with hash anchors (default).
 * index   = row N is compared with row N, nothing else.
 * key     = rows are matched by the value in `keyColumn`.
 */
export type RowMatching = "aligned" | "index" | "key";

/** values = compare computed values; formulas = compare the formula when a cell has one. */
export type CompareMode = "values" | "formulas";

export interface DiffOptions {
  rowMatching: RowMatching;
  /** 0-based column index. Used only when rowMatching is "key". */
  keyColumn: number;
  compareMode: CompareMode;
  ignoreCase: boolean;
  trimWhitespace: boolean;
  /** Treat empty-string cells as absent and skip rows that contain no cells. */
  ignoreEmpty: boolean;
}

export const DEFAULT_OPTIONS: DiffOptions = {
  rowMatching: "aligned",
  keyColumn: 0,
  compareMode: "values",
  ignoreCase: false,
  trimWhitespace: false,
  ignoreEmpty: false,
};

/* ------------------------------------------------------------------- result */

export type RowStatus = "same" | "added" | "removed" | "changed";
export type CellStatus = "added" | "removed" | "changed";

/** What differs in a changed cell. */
export type ChangeKind = "value" | "formula" | "both";

export interface CellDiff {
  col: number;
  status: CellStatus;
  /** Set only when status is "changed". */
  kind?: ChangeKind;
}

/**
 * One line of the side-by-side view. `orig` / `mod` are row indexes into the
 * respective SheetData.rows, or -1 when the row exists on one side only.
 */
export interface AlignedRow {
  orig: number;
  mod: number;
  status: RowStatus;
  /** Present for status "changed", "added" and "removed". Sorted by col. */
  cells?: CellDiff[];
}

export interface DiffCounts {
  addedRows: number;
  removedRows: number;
  changedRows: number;
  addedCells: number;
  removedCells: number;
  changedCells: number;
  mergeChanges: number;
}

export type SheetStatus = "matched" | "renamed" | "added" | "removed";

export interface SheetDiff {
  status: SheetStatus;
  /** Index into the original workbook's sheets, or -1 for an added sheet. */
  origIndex: number;
  /** Index into the modified workbook's sheets, or -1 for a removed sheet. */
  modIndex: number;
  origName: string | null;
  modName: string | null;
  /** max(colCount) of both sides. */
  colCount: number;
  rows: AlignedRow[];
  counts: DiffCounts;
  mergesAdded: string[];
  mergesRemoved: string[];
  /** True when this sheet has no differences of any kind (including its own status). */
  identical: boolean;
}

export interface WorkbookDiff {
  /** Ordered for display: modified-workbook order, removed sheets near their old position. */
  sheets: SheetDiff[];
  /** True when the matched sheets appear in a different order. Informational only. */
  sheetOrderChanged: boolean;
  identical: boolean;
  totals: DiffCounts & { addedSheets: number; removedSheets: number; renamedSheets: number };
}

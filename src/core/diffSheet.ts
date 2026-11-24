import { alignByIndex, alignByKey, alignBySequence, type KeyedRowRef, type RowPair, type RowRef } from "./align";
import { cyrb53 } from "./hash";
import { cellSignature, formulaSignature, isAbsent, keyOf, rowSignature, valueSignature } from "./normalize";
import { forEachPresent } from "./sparse";
import type { AlignedRow, Cell, CellDiff, ChangeKind, DiffCounts, DiffOptions, Row, SheetData } from "./types";

export interface SheetContentDiff {
  colCount: number;
  rows: AlignedRow[];
  counts: DiffCounts;
  mergesAdded: string[];
  mergesRemoved: string[];
}

export function emptyCounts(): DiffCounts {
  return {
    addedRows: 0,
    removedRows: 0,
    changedRows: 0,
    addedCells: 0,
    removedCells: 0,
    changedCells: 0,
    mergeChanges: 0,
  };
}

export function hasDifferences(c: DiffCounts): boolean {
  return c.addedRows + c.removedRows + c.changedRows + c.mergeChanges > 0;
}

interface PreparedSheet {
  refs: RowRef[];
  /** Signature per row index; "" for empty rows. */
  sigs: string[];
}

function prepare(sheet: SheetData | null, opts: DiffOptions): PreparedSheet {
  const refs: RowRef[] = [];
  const sigs: string[] = [];
  if (!sheet) return { refs, sigs };
  for (let r = 0; r < sheet.rows.length; r++) {
    const sig = rowSignature(sheet.rows[r], opts);
    sigs.push(sig);
    if (opts.ignoreEmpty && sig === "") continue;
    refs.push({ index: r, hash: cyrb53(sig), sig });
  }
  return { refs, sigs };
}

function keyedRefs(sheet: SheetData | null, refs: RowRef[], opts: DiffOptions): KeyedRowRef[] {
  if (!sheet) return [];
  return refs.map((ref) => ({ index: ref.index, key: keyOf(sheet.rows[ref.index], opts.keyColumn, opts) }));
}

function align(orig: SheetData | null, mod: SheetData | null, a: RowRef[], b: RowRef[], opts: DiffOptions): RowPair[] {
  switch (opts.rowMatching) {
    case "index":
      return alignByIndex(a, b);
    case "key":
      return alignByKey(keyedRefs(orig, a, opts), keyedRefs(mod, b, opts));
    case "aligned":
      return alignBySequence(a, b);
  }
}

/** Collect present cells of a sparse row in ascending column order in O(populated) time. */
function presentEntries(row: Row | undefined, opts: DiffOptions): Array<{ col: number; cell: Cell }> {
  const out: Array<{ col: number; cell: Cell }> = [];
  if (!row) return out;
  forEachPresent(row, (cell, col) => {
    if (!isAbsent(cell, opts)) out.push({ col, cell });
  });
  return out;
}

/** Every present cell of a one-sided row, with the given status. */
function oneSidedCells(row: Row | undefined, status: "added" | "removed", opts: DiffOptions): CellDiff[] {
  const cells: CellDiff[] = [];
  if (!row) return cells;
  forEachPresent(row, (cell, col) => {
    if (!isAbsent(cell, opts)) cells.push({ col, status });
  });
  return cells;
}

/** Cell-by-cell comparison of two paired rows via sparse merge-join (O(|a| + |b|)). */
export function diffRowCells(a: Row | undefined, b: Row | undefined, opts: DiffOptions): CellDiff[] {
  const ea = presentEntries(a, opts);
  const eb = presentEntries(b, opts);
  const cells: CellDiff[] = [];
  let i = 0;
  let j = 0;
  while (i < ea.length || j < eb.length) {
    const left = ea[i];
    const right = eb[j];
    if (left && right && left.col === right.col) {
      if (cellSignature(left.cell, opts) !== cellSignature(right.cell, opts)) {
        cells.push({ col: left.col, status: "changed", kind: changeKind(left.cell, right.cell, opts) });
      }
      i++;
      j++;
    } else if (left && (!right || left.col < right.col)) {
      cells.push({ col: left.col, status: "removed" });
      i++;
    } else if (right) {
      cells.push({ col: right.col, status: "added" });
      j++;
    }
  }
  return cells;
}

function changeKind(a: Cell, b: Cell, opts: DiffOptions): ChangeKind {
  const formulaChanged = formulaSignature(a, opts) !== formulaSignature(b, opts);
  const valueChanged = valueSignature(a, opts) !== valueSignature(b, opts);
  if (formulaChanged && valueChanged) return "both";
  return formulaChanged ? "formula" : "value";
}

/**
 * Diff the contents of two sheets. Pass null for a side that does not exist
 * (added or removed sheet); every row of the other side is then added/removed.
 */
export function diffSheetContents(orig: SheetData | null, mod: SheetData | null, opts: DiffOptions): SheetContentDiff {
  const pa = prepare(orig, opts);
  const pb = prepare(mod, opts);
  const pairs = align(orig, mod, pa.refs, pb.refs, opts);
  const counts = emptyCounts();
  const rows: AlignedRow[] = new Array(pairs.length);

  for (let k = 0; k < pairs.length; k++) {
    const { orig: o, mod: m } = pairs[k]!;
    if (o === -1) {
      const cells = oneSidedCells(mod?.rows[m], "added", opts);
      counts.addedRows++;
      counts.addedCells += cells.length;
      rows[k] = { orig: -1, mod: m, status: "added", cells };
    } else if (m === -1) {
      const cells = oneSidedCells(orig?.rows[o], "removed", opts);
      counts.removedRows++;
      counts.removedCells += cells.length;
      rows[k] = { orig: o, mod: -1, status: "removed", cells };
    } else if (pa.sigs[o] === pb.sigs[m]) {
      rows[k] = { orig: o, mod: m, status: "same" };
    } else {
      const cells = diffRowCells(orig?.rows[o], mod?.rows[m], opts);
      counts.changedRows++;
      for (const cell of cells) {
        if (cell.status === "added") counts.addedCells++;
        else if (cell.status === "removed") counts.removedCells++;
        else counts.changedCells++;
      }
      rows[k] = { orig: o, mod: m, status: "changed", cells };
    }
  }

  const mergesA = new Set(orig?.merges ?? []);
  const mergesB = new Set(mod?.merges ?? []);
  const mergesAdded = [...mergesB].filter((r) => !mergesA.has(r));
  const mergesRemoved = [...mergesA].filter((r) => !mergesB.has(r));
  counts.mergeChanges = mergesAdded.length + mergesRemoved.length;

  return {
    colCount: Math.max(orig?.colCount ?? 0, mod?.colCount ?? 0),
    rows,
    counts,
    mergesAdded,
    mergesRemoved,
  };
}

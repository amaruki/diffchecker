import { forEachPresent } from "./sparse";
import type { Cell, DiffOptions, Row } from "./types";

/**
 * Normalization turns a cell into a comparison string ("signature") under the
 * active options. Two cells are equal when their signatures are equal.
 * Formatting (number formats, date formats, styles) never enters a signature.
 */

type NormalizeOptions = Pick<DiffOptions, "ignoreCase" | "trimWhitespace" | "ignoreEmpty" | "compareMode">;

function normalizeText(s: string, opts: NormalizeOptions): string {
  let out = s;
  if (opts.trimWhitespace) out = out.trim();
  if (opts.ignoreCase) out = out.toLowerCase();
  return out;
}

/**
 * Excel stores 15 significant digits; anything past that is float noise.
 * A decimal string of 15 or fewer characters has at most 15 significant digits,
 * so it skips the slower toPrecision round trip.
 */
function canonicalNumber(n: number): string {
  const s = String(n);
  if (s.length <= 15 || !Number.isFinite(n)) return s;
  return String(Number(n.toPrecision(15)));
}

/** Signature of the computed value. Type is part of it: number 5 differs from text "5". */
export function valueSignature(cell: Cell, opts: NormalizeOptions): string {
  switch (cell.type) {
    case "s":
      return "s:" + normalizeText(String(cell.value), opts);
    case "n":
      return "n:" + canonicalNumber(Number(cell.value));
    case "b":
      return cell.value ? "b:1" : "b:0";
    case "d":
      return "d:" + String(cell.value);
    case "e":
      return "e:" + cell.text;
  }
}

export function formulaSignature(cell: Cell, opts: NormalizeOptions): string | null {
  if (cell.formula === undefined) return null;
  let f = opts.trimWhitespace ? cell.formula.trim() : cell.formula;
  if (opts.ignoreCase) f = f.toUpperCase();
  return f;
}

/** True when the cell should count as "no cell" under the options. */
export function isAbsent(cell: Cell | undefined, opts: NormalizeOptions): cell is undefined {
  if (cell === undefined) return true;
  if (!opts.ignoreEmpty || cell.formula !== undefined || cell.type !== "s") return false;
  return normalizeText(String(cell.value), opts) === "";
}

/** The string that decides equality for one cell under the active compare mode. */
export function cellSignature(cell: Cell, opts: NormalizeOptions): string {
  if (opts.compareMode === "formulas") {
    const f = formulaSignature(cell, opts);
    if (f !== null) return "=" + f;
  }
  return valueSignature(cell, opts);
}

/**
 * Row signature: injective length-prefixed encoding of (column, cell signature) for every present cell.
 * Uses sparse iteration so wide sparse rows (e.g. a single cell at XFD) stay O(populated).
 * Returns "" for a row with no present cells.
 */
export function rowSignature(row: Row | undefined, opts: NormalizeOptions): string {
  if (row === undefined) return "";
  let sig = "";
  forEachPresent(row, (cell, c) => {
    if (isAbsent(cell, opts)) return;
    const cs = cellSignature(cell, opts);
    sig += `${c}:${cs.length}:${cs};`;
  });
  return sig;
}

/** Normalized key-column value used for key-based row matching. */
export function keyOf(row: Row | undefined, keyColumn: number, opts: NormalizeOptions): string {
  const cell = row?.[keyColumn];
  if (isAbsent(cell, opts)) return "";
  return valueSignature(cell, opts);
}

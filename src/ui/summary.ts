import type { PackedSheetDiff } from "../core/pack";
import type { DiffCounts } from "../core/types";

/** Row-level difference count: the unit used by tabs and navigation. */
export function rowDiffCount(c: DiffCounts): number {
  return c.addedRows + c.removedRows + c.changedRows + c.mergeChanges;
}

export function sheetTitle(s: PackedSheetDiff): string {
  if (s.status === "renamed") return `${s.origName} → ${s.modName}`;
  return s.modName ?? s.origName ?? "(unnamed)";
}

export function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
}

import { diffSheetContents, emptyCounts, hasDifferences } from "./diffSheet";
import { cyrb53 } from "./hash";
import { rowSignature } from "./normalize";
import type { DiffCounts, DiffOptions, SheetData, SheetDiff, SheetStatus, WorkbookData, WorkbookDiff } from "./types";

/** Minimum Jaccard similarity of row-hash sets for two unmatched sheets to count as a rename. */
export const RENAME_SIMILARITY = 0.5;

interface SheetPair {
  status: SheetStatus;
  origIndex: number;
  modIndex: number;
}

function rowHashSet(sheet: SheetData, opts: DiffOptions): Set<number> {
  const set = new Set<number>();
  for (const row of sheet.rows) {
    const sig = rowSignature(row, opts);
    if (sig !== "") set.add(cyrb53(sig));
  }
  return set;
}

function jaccard(a: Set<number>, b: Set<number>): number {
  // Two unrelated empty sheets carry no content similarity; exact-name empty sheets are matched earlier.
  if (a.size === 0 || b.size === 0) return 0;
  let common = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const h of small) if (large.has(h)) common++;
  return common / (a.size + b.size - common);
}

/** Pair sheets by exact name (1-to-1 even if duplicate names exist), then pair leftovers by content similarity (renames). */
export function matchSheets(orig: SheetData[], mod: SheetData[], opts: DiffOptions): SheetPair[] {
  const pairs: SheetPair[] = [];
  const modQueues = new Map<string, number[]>();
  mod.forEach((s, i) => {
    const q = modQueues.get(s.name);
    if (q) q.push(i);
    else modQueues.set(s.name, [i]);
  });
  const modHeads = new Map<string, number>();
  const origLeft: number[] = [];
  const modUsed = new Set<number>();
  orig.forEach((sheet, i) => {
    const q = modQueues.get(sheet.name);
    const h = modHeads.get(sheet.name) ?? 0;
    const m = q?.[h];
    if (m === undefined) {
      origLeft.push(i);
    } else {
      modHeads.set(sheet.name, h + 1);
      pairs.push({ status: "matched", origIndex: i, modIndex: m });
      modUsed.add(m);
    }
  });
  const modLeft = mod.map((_, i) => i).filter((i) => !modUsed.has(i));

  if (origLeft.length > 0 && modLeft.length > 0) {
    const hashesA = new Map(origLeft.map((i) => [i, rowHashSet(orig[i]!, opts)]));
    const hashesB = new Map(modLeft.map((i) => [i, rowHashSet(mod[i]!, opts)]));
    const candidates: Array<{ o: number; m: number; score: number }> = [];
    for (const o of origLeft) {
      for (const m of modLeft) {
        const score = jaccard(hashesA.get(o)!, hashesB.get(m)!);
        if (score >= RENAME_SIMILARITY) candidates.push({ o, m, score });
      }
    }
    candidates.sort((x, y) => y.score - x.score || x.o - y.o || x.m - y.m);
    const takenO = new Set<number>();
    const takenM = new Set<number>();
    for (const c of candidates) {
      if (takenO.has(c.o) || takenM.has(c.m)) continue;
      takenO.add(c.o);
      takenM.add(c.m);
      pairs.push({ status: "renamed", origIndex: c.o, modIndex: c.m });
    }
    for (const o of origLeft) if (!takenO.has(o)) pairs.push({ status: "removed", origIndex: o, modIndex: -1 });
    for (const m of modLeft) if (!takenM.has(m)) pairs.push({ status: "added", origIndex: -1, modIndex: m });
  } else {
    for (const o of origLeft) pairs.push({ status: "removed", origIndex: o, modIndex: -1 });
    for (const m of modLeft) pairs.push({ status: "added", origIndex: -1, modIndex: m });
  }
  return orderForDisplay(pairs);
}

/** Modified-workbook order; each removed sheet goes before the first sheet that followed it originally. */
function orderForDisplay(pairs: SheetPair[]): SheetPair[] {
  const present = pairs.filter((p) => p.modIndex !== -1).sort((x, y) => x.modIndex - y.modIndex);
  const removed = pairs.filter((p) => p.modIndex === -1).sort((x, y) => x.origIndex - y.origIndex);
  const out: SheetPair[] = [];
  let r = 0;
  for (const p of present) {
    if (p.origIndex !== -1) {
      while (r < removed.length && removed[r]!.origIndex < p.origIndex) out.push(removed[r++]!);
    }
    out.push(p);
  }
  while (r < removed.length) out.push(removed[r++]!);
  return out;
}

function isOrderChanged(pairs: SheetPair[]): boolean {
  const both = pairs.filter((p) => p.origIndex !== -1 && p.modIndex !== -1).sort((x, y) => x.modIndex - y.modIndex);
  for (let k = 1; k < both.length; k++) if (both[k]!.origIndex < both[k - 1]!.origIndex) return true;
  return false;
}

function addCounts(into: DiffCounts, c: DiffCounts): void {
  into.addedRows += c.addedRows;
  into.removedRows += c.removedRows;
  into.changedRows += c.changedRows;
  into.addedCells += c.addedCells;
  into.removedCells += c.removedCells;
  into.changedCells += c.changedCells;
  into.mergeChanges += c.mergeChanges;
}

export function diffWorkbooks(orig: WorkbookData, mod: WorkbookData, opts: DiffOptions): WorkbookDiff {
  const pairs = matchSheets(orig.sheets, mod.sheets, opts);
  const totals = { ...emptyCounts(), addedSheets: 0, removedSheets: 0, renamedSheets: 0 };

  const sheets: SheetDiff[] = pairs.map((p) => {
    const a = p.origIndex === -1 ? null : orig.sheets[p.origIndex]!;
    const b = p.modIndex === -1 ? null : mod.sheets[p.modIndex]!;
    const content = diffSheetContents(a, b, opts);
    addCounts(totals, content.counts);
    if (p.status === "added") totals.addedSheets++;
    if (p.status === "removed") totals.removedSheets++;
    if (p.status === "renamed") totals.renamedSheets++;
    return {
      status: p.status,
      origIndex: p.origIndex,
      modIndex: p.modIndex,
      origName: a?.name ?? null,
      modName: b?.name ?? null,
      ...content,
      identical: p.status === "matched" && !hasDifferences(content.counts),
    };
  });

  return {
    sheets,
    sheetOrderChanged: isOrderChanged(pairs),
    identical: sheets.every((s) => s.identical),
    totals,
  };
}

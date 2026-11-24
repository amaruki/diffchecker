/**
 * Transferable encoding of a TextDiff (same approach as core/pack.ts):
 * typed arrays are transferred zero-copy, lines travel as one joined string.
 */
import { ROW_STATUS } from "../core/pack";
import type { Range, TextDiff } from "./types";

export interface PackedLines {
  count: number;
  text: string;
  /** End offset of each line in `text`; the start is the previous end (or 0). */
  ends: Int32Array;
  /** Longest line length, for the horizontal scroll width. */
  maxLength: number;
}

/** Highlight ranges per aligned row (CSR): row k owns pairs ptr[k] .. ptr[k+1]-1 of `ranges`. */
export interface PackedHighlights {
  ptr: Int32Array;
  /** Flattened [start, end] pairs. */
  ranges: Int32Array;
}

export interface PackedTextRows {
  length: number;
  orig: Int32Array;
  mod: Int32Array;
  /** Index into ROW_STATUS. */
  status: Uint8Array;
}

export type PackedTextDiff = Omit<TextDiff, "left" | "right" | "rows"> & {
  left: PackedLines;
  right: PackedLines;
  rows: PackedTextRows;
  hlOrig: PackedHighlights;
  hlMod: PackedHighlights;
};

export function packLines(lines: string[]): PackedLines {
  const ends = new Int32Array(lines.length);
  let total = 0;
  let maxLength = 0;
  lines.forEach((l, i) => {
    total += l.length;
    ends[i] = total;
    if (l.length > maxLength) maxLength = l.length;
  });
  return { count: lines.length, text: lines.join(""), ends, maxLength };
}

export function lineAt(lines: PackedLines, i: number): string {
  return lines.text.slice(i === 0 ? 0 : lines.ends[i - 1]!, lines.ends[i]!);
}

function packHighlights(perRow: Array<Range[] | undefined>): PackedHighlights {
  let n = 0;
  for (const r of perRow) n += r?.length ?? 0;
  const ptr = new Int32Array(perRow.length + 1);
  const ranges = new Int32Array(n * 2);
  let k = 0;
  perRow.forEach((rs, i) => {
    ptr[i] = k;
    for (const [s, e] of rs ?? []) {
      ranges[2 * k] = s;
      ranges[2 * k + 1] = e;
      k++;
    }
  });
  ptr[perRow.length] = k;
  return { ptr, ranges };
}

export function highlightsAt(h: PackedHighlights, row: number): Range[] {
  const out: Range[] = [];
  for (let k = h.ptr[row]!; k < h.ptr[row + 1]!; k++) out.push([h.ranges[2 * k]!, h.ranges[2 * k + 1]!]);
  return out;
}

export function packTextDiff(diff: TextDiff): PackedTextDiff {
  const n = diff.rows.length;
  const rows: PackedTextRows = {
    length: n,
    orig: new Int32Array(n),
    mod: new Int32Array(n),
    status: new Uint8Array(n),
  };
  diff.rows.forEach((r, i) => {
    rows.orig[i] = r.orig;
    rows.mod[i] = r.mod;
    rows.status[i] = ROW_STATUS.indexOf(r.status);
  });
  return {
    ...diff,
    left: packLines(diff.left),
    right: packLines(diff.right),
    rows,
    hlOrig: packHighlights(diff.rows.map((r) => r.hlOrig)),
    hlMod: packHighlights(diff.rows.map((r) => r.hlMod)),
  };
}

export function textDiffTransferables(d: PackedTextDiff): ArrayBuffer[] {
  return [d.left.ends, d.right.ends, d.rows.orig, d.rows.mod, d.rows.status, d.hlOrig.ptr, d.hlOrig.ranges, d.hlMod.ptr, d.hlMod.ranges].map(
    (a) => a.buffer as ArrayBuffer,
  );
}

/**
 * View-model helpers for the text diff: which rows are visible and where each change starts.
 * Pure functions over the packed status array, so they are unit-tested without a DOM.
 */
import { ROW_STATUS } from "../core/pack";

export const CONTEXT_LINES = 3;
const SAME = ROW_STATUS.indexOf("same");

/**
 * Visible entries in display order. A value k >= 0 is an aligned row index.
 * A negative value -n stands for n hidden unchanged rows (a collapsed gap).
 * With onlyChanges off every row is visible.
 */
export function visibleLines(status: Uint8Array, onlyChanges: boolean, context = CONTEXT_LINES): Int32Array {
  const n = status.length;
  if (!onlyChanges) return Int32Array.from({ length: n }, (_, i) => i);
  const keep = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    if (status[k] === SAME) continue;
    for (let c = Math.max(0, k - context); c <= Math.min(n - 1, k + context); c++) keep[c] = 1;
  }
  const out: number[] = [];
  let hidden = 0;
  for (let k = 0; k < n; k++) {
    if (keep[k]) {
      if (hidden > 0) out.push(-hidden);
      hidden = 0;
      out.push(k);
    } else {
      hidden++;
    }
  }
  if (hidden > 0) out.push(-hidden);
  return Int32Array.from(out);
}

/** Visible indexes where a block of consecutive changed rows begins: the navigation stops. */
export function changeStarts(visible: Int32Array, status: Uint8Array): Int32Array {
  const out: number[] = [];
  let inBlock = false;
  for (let v = 0; v < visible.length; v++) {
    const k = visible[v]!;
    const changed = k >= 0 && status[k] !== SAME;
    if (changed && !inBlock) out.push(v);
    inBlock = changed;
  }
  return Int32Array.from(out);
}

/** Inverse of `visible`: aligned row → visible index, or -1 when hidden. */
export function rowToVisible(visible: Int32Array, rowCount: number): Int32Array {
  const out = new Int32Array(rowCount).fill(-1);
  visible.forEach((k, v) => {
    if (k >= 0) out[k] = v;
  });
  return out;
}

/** Line index on one side → aligned row index. */
export function lineToRow(sideRows: Int32Array, lineCount: number): Int32Array {
  const out = new Int32Array(lineCount).fill(-1);
  sideRows.forEach((line, k) => {
    if (line >= 0) out[line] = k;
  });
  return out;
}

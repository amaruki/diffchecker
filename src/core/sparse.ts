/**
 * Iterate populated entries of a potentially sparse array in ascending index order.
 * For small dense arrays (length <= 64), uses a tight indexed loop.
 * For wider arrays (e.g. a single cell at column XFD = 16383), uses `Object.keys()`
 * which visits only populated own indices in O(populated) time (guaranteed ascending
 * numeric order for array indices per ECMAScript `[[OwnPropertyKeys]]`), avoiding
 * JavaScriptCore/V8's O(length) hole-scanning in `Array.prototype.forEach`.
 */
export function forEachPresent<T>(arr: readonly (T | undefined)[], fn: (value: T, index: number) => void): void {
  const len = arr.length;
  if (len === 0) return;
  if (len <= 64) {
    for (let i = 0; i < len; i++) {
      const v = arr[i];
      if (v !== undefined) fn(v, i);
    }
    return;
  }
  const keys = Object.keys(arr);
  for (let k = 0; k < keys.length; k++) {
    const key = keys[k]!;
    const idx = Number(key);
    if (!Number.isInteger(idx) || idx < 0 || idx >= len) continue;
    const v = arr[idx];
    if (v !== undefined) fn(v, idx);
  }
}

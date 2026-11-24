/** Maximum 0-based column index supported by Excel (.xlsx): column XFD. */
export const MAX_COLUMN_INDEX = 16_383;

/** 0 → "A", 25 → "Z", 26 → "AA", 16383 → "XFD". */
export function columnName(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index > MAX_COLUMN_INDEX) {
    throw new RangeError(`Column index ${index} is out of range (0..${MAX_COLUMN_INDEX}).`);
  }
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/** "A" → 0, "aa" → 26, "XFD" → 16383. Returns null for invalid or out-of-range Excel column names. */
export function parseColumnName(input: string): number | null {
  const s = input.trim().toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(s)) return null;
  let n = 0;
  for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64);
  const index = n - 1;
  return index <= MAX_COLUMN_INDEX ? index : null;
}

export function cellAddress(row: number, col: number): string {
  if (!Number.isInteger(row) || row < 0) {
    throw new RangeError(`Row index ${row} must be a non-negative integer.`);
  }
  return `${columnName(col)}${row + 1}`;
}

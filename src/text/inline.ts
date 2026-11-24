import type { Range } from "./types";

/** Word, whitespace run, or single punctuation character. Unicode-aware. */
const TOKEN_RE = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu;

/** Lines whose token grid exceeds this get a whole-line highlight instead of an LCS. */
const TOKEN_CELL_LIMIT = 250_000;
/** Skip regex tokenization altogether on huge minified lines to avoid multi-GB Token allocations. */
const MAX_INLINE_DIFF_CHARS = 32_768;

interface Token {
  start: number;
  end: number;
  key: string;
}

function tokenize(line: string, offset: number, normalize: (token: string) => string): Token[] {
  const out: Token[] = [];
  for (const m of line.matchAll(TOKEN_RE)) {
    const start = offset + m.index;
    out.push({ start, end: start + m[0].length, key: normalize(m[0]) });
  }
  return out;
}

/** Merge touching ranges so the renderer emits fewer spans. */
function mergeRanges(ranges: Range[]): Range[] {
  const out: Range[] = [];
  for (const r of ranges) {
    const last = out[out.length - 1];
    if (last && last[1] >= r[0]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/**
 * Word-level difference of two lines: the character ranges on each side that are
 * not part of the longest common token subsequence.
 * `normalize` maps a token to its comparison form (case / whitespace options).
 */
export function inlineDiff(
  a: string,
  b: string,
  normalize: (token: string) => string,
  trimEdges = false,
): { a: Range[]; b: Range[] } {
  let aStart = 0;
  let aEnd = a.length;
  let bStart = 0;
  let bEnd = b.length;

  if (trimEdges) {
    while (aStart < aEnd && /\s/.test(a[aStart]!)) aStart++;
    while (aEnd > aStart && /\s/.test(a[aEnd - 1]!)) aEnd--;
    while (bStart < bEnd && /\s/.test(b[bStart]!)) bStart++;
    while (bEnd > bStart && /\s/.test(b[bEnd - 1]!)) bEnd--;
  }

  // Fast character-level guard for huge single-line payloads (e.g., 20 MB minified JSON).
  if (aEnd - aStart > MAX_INLINE_DIFF_CHARS || bEnd - bStart > MAX_INLINE_DIFF_CHARS) {
    let pre = 0;
    const minLen = Math.min(aEnd - aStart, bEnd - bStart);
    while (pre < minLen && a.charCodeAt(aStart + pre) === b.charCodeAt(bStart + pre)) pre++;
    let suf = 0;
    while (suf < minLen - pre && a.charCodeAt(aEnd - 1 - suf) === b.charCodeAt(bEnd - 1 - suf)) suf++;
    return {
      a: aStart + pre < aEnd - suf ? [[aStart + pre, aEnd - suf]] : [],
      b: bStart + pre < bEnd - suf ? [[bStart + pre, bEnd - suf]] : [],
    };
  }

  const ta = tokenize(a.slice(aStart, aEnd), aStart, normalize);
  const tb = tokenize(b.slice(bStart, bEnd), bStart, normalize);

  let pre = 0;
  while (pre < ta.length && pre < tb.length && ta[pre]!.key === tb[pre]!.key) pre++;
  let suf = 0;
  while (suf < ta.length - pre && suf < tb.length - pre && ta[ta.length - 1 - suf]!.key === tb[tb.length - 1 - suf]!.key) suf++;

  const ma = ta.slice(pre, ta.length - suf);
  const mb = tb.slice(pre, tb.length - suf);
  const p = ma.length;
  const q = mb.length;
  const span = (t: Token[]): Range[] => (t.length === 0 ? [] : [[t[0]!.start, t[t.length - 1]!.end]]);

  if (p === 0 || q === 0 || p * q > TOKEN_CELL_LIMIT) return { a: span(ma), b: span(mb) };

  // dp[i][j] = LCS length of ma[i..] and mb[j..]
  const w = q + 1;
  const dp = new Uint32Array((p + 1) * w);
  for (let i = p - 1; i >= 0; i--) {
    for (let j = q - 1; j >= 0; j--) {
      dp[i * w + j] =
        ma[i]!.key === mb[j]!.key ? dp[(i + 1) * w + j + 1]! + 1 : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!);
    }
  }
  const ra: Range[] = [];
  const rb: Range[] = [];
  let i = 0;
  let j = 0;
  while (i < p && j < q) {
    if (ma[i]!.key === mb[j]!.key) {
      i++;
      j++;
    } else if (dp[(i + 1) * w + j]! >= dp[i * w + j + 1]!) {
      ra.push([ma[i]!.start, ma[i]!.end]);
      i++;
    } else {
      rb.push([mb[j]!.start, mb[j]!.end]);
      j++;
    }
  }
  for (; i < p; i++) ra.push([ma[i]!.start, ma[i]!.end]);
  for (; j < q; j++) rb.push([mb[j]!.start, mb[j]!.end]);
  return { a: mergeRanges(ra), b: mergeRanges(rb) };
}

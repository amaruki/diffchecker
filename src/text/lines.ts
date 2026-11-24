import type { TextDiffOptions } from "./types";

type LineOptions = Pick<TextDiffOptions, "ignoreWhitespace" | "ignoreCase">;

/**
 * Split on \r\n, \r or \n. A final line terminator does not create an extra empty line,
 * so "a\nb\n" and "a\nb" both give ["a", "b"]. "" gives [].
 */
export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split(/\r\n|\r|\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Comparison form of a line under the text options. */
export function normalizeLine(line: string, opts: LineOptions): string {
  let out = line;
  if (opts.ignoreWhitespace) out = out.trim().replace(/\s+/g, " ");
  if (opts.ignoreCase) out = out.toLowerCase();
  return out;
}

export function isBlank(line: string): boolean {
  return /^\s*$/.test(line);
}

/** Normalize line endings only; used to explain why equal-looking texts are not byte-identical. */
export function unifyLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

const WORD_RE = /[\p{L}\p{N}_]+/gu;
const MAX_LINE_WORDS = 512;

/** Words of a line (letters, digits, underscore), in order. */
export function lineWords(line: string): string[] {
  return line.match(WORD_RE) ?? [];
}

export interface WordBag {
  total: number;
  counts: Map<string, number>;
}

/** Precomputed bounded word multiset for fast gap similarity comparisons without per-pair Map rebuilds. */
export function lineWordBag(line: string, maxWords = MAX_LINE_WORDS): WordBag {
  const counts = new Map<string, number>();
  let total = 0;
  for (const m of line.matchAll(WORD_RE)) {
    const w = m[0];
    counts.set(w, (counts.get(w) ?? 0) + 1);
    if (++total >= maxWords) break;
  }
  return { total, counts };
}

/** Dice coefficient between two precomputed word multisets, from 0 to 1. */
export function wordBagSimilarity(a: WordBag, b: WordBag): number {
  if (a.total === 0 || b.total === 0) return 0;
  const [small, large] = a.counts.size <= b.counts.size ? [a.counts, b.counts] : [b.counts, a.counts];
  let common = 0;
  for (const [w, ca] of small) {
    const cb = large.get(w);
    if (cb) common += ca < cb ? ca : cb;
  }
  return (2 * common) / (a.total + b.total);
}

/**
 * Dice coefficient of two word multisets, from 0 to 1: 2·common / (|a| + |b|).
 * Lines without words (brackets, punctuation) score 0 against everything.
 */
export function wordSimilarity(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const w of a) counts.set(w, (counts.get(w) ?? 0) + 1);
  let common = 0;
  for (const w of b) {
    const c = counts.get(w);
    if (c) {
      common++;
      counts.set(w, c - 1);
    }
  }
  return (2 * common) / (a.length + b.length);
}

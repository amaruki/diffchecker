import { alignBySequence, realignGaps, type RowPair, type RowRef } from "../core/align";
import { cyrb53 } from "../core/hash";
import { inlineDiff } from "./inline";
import {
  diffJson,
  exceedsJsonDepth,
  exceedsRawJsonDepth,
  JsonParseError,
  looksLikeJson,
  MAX_JSON_DEPTH,
  parseJson,
  printJson,
  type JsonValue,
} from "./json";
import { isBlank, lineWordBag, normalizeLine, splitLines, unifyLineEndings, wordBagSimilarity, type WordBag } from "./lines";
import type { AlignedLine, TextCounts, TextDiff, TextDiffOptions, TextFormat, TextInput, TextNote } from "./types";

interface Prepared {
  format: TextFormat;
  left: string[];
  right: string[];
  /** Comparison form of each line. */
  sigsL: string[];
  sigsR: string[];
  notes: TextNote[];
  json: TextDiff["json"];
}

const side = (i: number) => (i === 0 ? "Original" : "Modified");

/** In JSON mode a trailing comma is layout, not content: appending an array element must not change the line above. */
const jsonSig = (line: string) => (line.endsWith(",") ? line.slice(0, -1) : line);

function prepareText(a: TextInput, b: TextInput, opts: TextDiffOptions, notes: TextNote[]): Prepared {
  const left = splitLines(a.text);
  const right = splitLines(b.text);
  return {
    format: "text",
    left,
    right,
    sigsL: left.map((l) => normalizeLine(l, opts)),
    sigsR: right.map((l) => normalizeLine(l, opts)),
    notes,
    json: null,
  };
}

/** Parse both sides as JSON, or explain why not and fall back to text. */
function prepare(a: TextInput, b: TextInput, opts: TextDiffOptions): Prepared {
  const inputs = [a, b];
  const nonEmpty = inputs.filter((x) => x.text.trim() !== "");
  const wantJson =
    opts.format === "json" ||
    (opts.format === "auto" && nonEmpty.length > 0 && nonEmpty.every((x) => looksLikeJson(x.name, x.text)));
  if (!wantJson) return prepareText(a, b, opts, []);

  const values: Array<JsonValue | undefined> = [];
  const notes: TextNote[] = [];
  inputs.forEach((input, i) => {
    if (input.text.trim() === "") {
      values.push(undefined);
      return;
    }
    if (exceedsRawJsonDepth(input.text, MAX_JSON_DEPTH)) {
      notes.push({
        level: "warning",
        message: `${side(i)} nests deeper than ${MAX_JSON_DEPTH} levels. Both sides are compared as plain text to stay safe.`,
      });
      return;
    }
    try {
      values.push(parseJson(input.text));
    } catch (err) {
      const detail = err instanceof JsonParseError ? err.message : String(err);
      notes.push({ level: "warning", message: `${side(i)} is not valid JSON (${detail}). Both sides are compared as plain text.` });
    }
  });
  if (notes.length > 0) return prepareText(a, b, opts, notes);

  for (let i = 0; i < values.length; i++) {
    if (exceedsJsonDepth(values[i], MAX_JSON_DEPTH)) {
      notes.push({
        level: "warning",
        message: `${side(i)} nests deeper than ${MAX_JSON_DEPTH} levels. Both sides are compared as plain text to stay safe.`,
      });
    }
  }
  if (notes.length > 0) return prepareText(a, b, opts, notes);

  try {
    const pa = printJson(values[0], opts.sortKeys);
    const pb = printJson(values[1], opts.sortKeys);
    return {
      format: "json",
      left: pa,
      right: pb,
      sigsL: pa.map(jsonSig),
      sigsR: pb.map(jsonSig),
      notes,
      json: diffJson(values[0], values[1], { sortKeys: opts.sortKeys }),
    };
  } catch (err) {
    // Nesting deep enough or formatted size large enough to exceed safe limits.
    const detail = err instanceof Error ? err.message : String(err);
    return prepareText(a, b, opts, [{ level: "warning", message: `The JSON could not be formatted (${detail}). Compared as plain text.` }]);
  }
}

function refsOf(sigs: string[], skipBlank: boolean): { refs: RowRef[]; blanks: number[] } {
  const refs: RowRef[] = [];
  const blanks: number[] = [];
  sigs.forEach((sig, index) => {
    if (skipBlank && isBlank(sig)) blanks.push(index);
    else refs.push({ index, sig, hash: cyrb53(sig) });
  });
  return { refs, blanks };
}

/** Lines in a gap pair as "changed" only when at least half their words match (Dice). */
const LINE_GAP = { minSimilarity: 0.5, cellLimit: 10_000 } as const;

/**
 * Line alignment: hash anchors first, then the lines between anchors pair by shared words,
 * so an edited line next to inserted lines pairs with its counterpart, not the line at the same offset.
 */
function alignLines(prep: Prepared, ra: RowRef[], rb: RowRef[]): RowPair[] {
  const bagsL = new Map<number, WordBag>();
  const bagsR = new Map<number, WordBag>();
  const bag = (cache: Map<number, WordBag>, sigs: string[], i: number) => {
    let b = cache.get(i);
    if (!b) cache.set(i, (b = lineWordBag(sigs[i]!)));
    return b;
  };
  const exact = (p: RowPair) => p.orig !== -1 && p.mod !== -1 && prep.sigsL[p.orig] === prep.sigsR[p.mod];
  return realignGaps(alignBySequence(ra, rb), exact, {
    ...LINE_GAP,
    similarity: (i, j) => wordBagSimilarity(bag(bagsL, prep.sigsL, i), bag(bagsR, prep.sigsR, j)),
  });
}

/**
 * Put skipped blank lines back in order. Blank lines that sit between the same two
 * aligned rows on both sides pair with each other; extras appear one-sided. All are "same".
 */
function withBlanks(pairs: RowPair[], blanksA: number[], blanksB: number[]): Array<RowPair & { blank: boolean }> {
  const out: Array<RowPair & { blank: boolean }> = [];
  let ia = 0;
  let ib = 0;
  const flush = (limitA: number, limitB: number) => {
    const fa: number[] = [];
    const fb: number[] = [];
    while (ia < blanksA.length && blanksA[ia]! < limitA) fa.push(blanksA[ia++]!);
    while (ib < blanksB.length && blanksB[ib]! < limitB) fb.push(blanksB[ib++]!);
    for (let k = 0; k < Math.max(fa.length, fb.length); k++) out.push({ orig: fa[k] ?? -1, mod: fb[k] ?? -1, blank: true });
  };
  for (const p of pairs) {
    flush(p.orig === -1 ? -1 : p.orig, p.mod === -1 ? -1 : p.mod);
    out.push({ ...p, blank: false });
  }
  flush(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  return out;
}

export function diffTexts(a: TextInput, b: TextInput, opts: TextDiffOptions): TextDiff {
  const prep = prepare(a, b, opts);
  const skipBlank = prep.format === "text" && opts.ignoreBlankLines;
  const ra = refsOf(prep.sigsL, skipBlank);
  const rb = refsOf(prep.sigsR, skipBlank);
  const pairs = withBlanks(alignLines(prep, ra.refs, rb.refs), ra.blanks, rb.blanks);

  const trimInlineEdges = prep.format === "text" && opts.ignoreWhitespace;
  const tokenNorm =
    prep.format === "json"
      ? (t: string) => t
      : (t: string) => (opts.ignoreWhitespace && /^\s+$/.test(t) ? " " : opts.ignoreCase ? t.toLowerCase() : t);

  const counts: TextCounts = { added: 0, removed: 0, changed: 0, unchanged: 0 };
  const rows: AlignedLine[] = pairs.map(({ orig, mod, blank }) => {
    if (blank) {
      counts.unchanged++;
      return { orig, mod, status: "same" };
    }
    if (orig === -1) {
      counts.added++;
      return { orig, mod, status: "added" };
    }
    if (mod === -1) {
      counts.removed++;
      return { orig, mod, status: "removed" };
    }
    if (prep.sigsL[orig] === prep.sigsR[mod]) {
      counts.unchanged++;
      return { orig, mod, status: "same" };
    }
    counts.changed++;
    const hl = inlineDiff(prep.left[orig]!, prep.right[mod]!, tokenNorm, trimInlineEdges);
    return { orig, mod, status: "changed", hlOrig: hl.a, hlMod: hl.b };
  });

  const identical = counts.added + counts.removed + counts.changed === 0;
  const rawIdentical = a.text === b.text;
  const notes = [...prep.notes];
  if (identical && !rawIdentical) {
    const normA = unifyLineEndings(a.text);
    const normB = unifyLineEndings(b.text);
    const why =
      normA === normB
        ? "line endings"
        : normA.replace(/\n$/, "") === normB.replace(/\n$/, "")
          ? "line endings or a trailing newline"
          : prep.format === "json"
            ? "formatting or key order"
            : "whitespace, case or blank lines ignored by the options";
    notes.push({ level: "info", message: `The inputs are not byte-identical. They differ only in ${why}.` });
  }
  if (prep.format === "json" && !identical && prep.json?.total === 0) {
    notes.push({ level: "info", message: "The documents hold the same data. Only the key order differs." });
  }

  return {
    format: prep.format,
    notes,
    left: prep.left,
    right: prep.right,
    rows,
    counts,
    identical,
    rawIdentical,
    json: prep.json,
  };
}

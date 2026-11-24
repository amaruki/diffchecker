import { alignBySequence, realignGaps, type RowPair, type RowRef } from "../core/align";
import { cyrb53 } from "../core/hash";
import type { JsonChange } from "./types";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** Max structural changes returned; the total is still counted. */
export const JSON_CHANGE_LIMIT = 5000;
/** Maximum JSON nesting depth processed structurally; deeper inputs fall back to plain text safely. */
export const MAX_JSON_DEPTH = 256;
/** Cap total pretty-printed characters so packLines cannot hit JS max string length. */
export const MAX_PRETTY_JSON_CHARS = 40_000_000;
const VALUE_PREVIEW = 120;

export class JsonParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsonParseError";
  }
}

/**
 * Fast O(N) bracket depth pre-scan on raw JSON text before JSON.parse runs.
 * Skips string literals and escape sequences so deeply nested valid JSON fails with
 * a clear depth warning instead of blowing the JS engine's JSON.parse call stack.
 */
export function exceedsRawJsonDepth(text: string, maxDepth = MAX_JSON_DEPTH): boolean {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === 92 /* \ */) {
        escaped = true;
      } else if (ch === 34 /* " */) {
        inString = false;
      }
      continue;
    }
    if (ch === 34 /* " */) {
      inString = true;
    } else if (ch === 91 /* [ */ || ch === 123 /* { */) {
      if (++depth > maxDepth) return true;
    } else if (ch === 93 /* ] */ || ch === 125 /* } */) {
      if (depth > 0) depth--;
    }
  }
  return false;
}

/** Iteratively checks whether a parsed JSON value nests deeper than `maxDepth` without risking stack overflow. */
export function exceedsJsonDepth(root: JsonValue | undefined, maxDepth = MAX_JSON_DEPTH): boolean {
  if (root === undefined || typeof root !== "object" || root === null) return false;
  const stack: Array<{ value: JsonValue; depth: number }> = [{ value: root, depth: 1 }];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.depth > maxDepth) return true;
    const { value, depth } = current;
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const child = value[i];
        if (typeof child === "object" && child !== null) stack.push({ value: child, depth: depth + 1 });
      }
    } else if (typeof value === "object" && value !== null) {
      const keys = Object.keys(value);
      for (let i = 0; i < keys.length; i++) {
        const child = value[keys[i]!];
        if (typeof child === "object" && child !== null) stack.push({ value: child, depth: depth + 1 });
      }
    }
  }
  return false;
}

/** Line and column (1-based) of a character offset. */
function lineColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lastBreak = -1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lastBreak = i;
    }
  }
  return { line, column: offset - lastBreak };
}

/** JSON.parse with an error message that names the line and column when the engine reports a position. */
export function parseJson(text: string): JsonValue {
  try {
    return JSON.parse(text) as JsonValue;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const pos = /position (\d+)/.exec(message);
    if (pos) {
      const { line, column } = lineColumn(text, Number(pos[1]));
      throw new JsonParseError(`line ${line}, column ${column}: ${message.replace(/\s*\(line \d+ column \d+\)/, "")}`);
    }
    throw new JsonParseError(message);
  }
}

/** True when the text plausibly holds JSON: a .json name, or a body starting with { or [. */
export function looksLikeJson(name: string | null, text: string): boolean {
  if (name && /\.(json|jsonc|geojson|har|webmanifest)$/i.test(name)) return true;
  return /^\s*[[{]/.test(text);
}

const IDENT_RE = /^[A-Za-z_$][\w$]*$/;

export function childPath(path: string, key: string | number): string {
  if (typeof key === "number") return `${path}[${key}]`;
  return IDENT_RE.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

const isObject = (v: JsonValue | undefined): v is { [key: string]: JsonValue } =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function objectKeys(v: { [key: string]: JsonValue }, sortKeys: boolean): string[] {
  const keys = Object.keys(v);
  return sortKeys ? keys.sort() : keys;
}

const INDENT = Array.from({ length: 32 }, (_, d) => "  ".repeat(d));
const indent = (depth: number) => INDENT[depth] ?? "  ".repeat(depth);

/**
 * Pretty-print with 2-space indentation, one value or bracket per line.
 * `undefined` (an empty input) prints as zero lines. `lineResolver` mirrors this layout.
 */
export function printJson(value: JsonValue | undefined, sortKeys: boolean, maxChars = MAX_PRETTY_JSON_CHARS): string[] {
  const lines: string[] = [];
  let totalChars = 0;
  const push = (line: string) => {
    totalChars += line.length + 1;
    if (totalChars > maxChars) {
      throw new RangeError(`Formatted JSON exceeds the ${(maxChars / 1_000_000).toFixed(0)}M-character display limit.`);
    }
    lines.push(line);
  };
  const walk = (v: JsonValue, depth: number, prefix: string, suffix: string): void => {
    if (Array.isArray(v)) {
      if (v.length === 0) return void push(`${indent(depth)}${prefix}[]${suffix}`);
      push(`${indent(depth)}${prefix}[`);
      v.forEach((item, i) => walk(item, depth + 1, "", i < v.length - 1 ? "," : ""));
      push(`${indent(depth)}]${suffix}`);
    } else if (isObject(v)) {
      const keys = objectKeys(v, sortKeys);
      if (keys.length === 0) return void push(`${indent(depth)}${prefix}{}${suffix}`);
      push(`${indent(depth)}${prefix}{`);
      keys.forEach((k, i) => walk(v[k]!, depth + 1, `${JSON.stringify(k)}: `, i < keys.length - 1 ? "," : ""));
      push(`${indent(depth)}}${suffix}`);
    } else {
      push(`${indent(depth)}${prefix}${JSON.stringify(v)}${suffix}`);
    }
  };
  if (value !== undefined) walk(value, 0, "", "");
  return lines;
}

/** One step of a path: object key or array index. */
export type Segment = string | number;

export function formatPath(segments: readonly Segment[]): string {
  return segments.reduce<string>((path, seg) => childPath(path, seg), "$");
}

/**
 * Line index (in printJson's output) where the value at a path starts, or -1.
 * Subtree line counts and child offsets are computed once per container and memoized,
 * so resolving many paths costs O(document) in total, not per path.
 */
export function lineResolver(root: JsonValue | undefined, sortKeys: boolean): (segments: readonly Segment[]) => number {
  const counts = new WeakMap<object, number>();
  const layouts = new WeakMap<object, { keyIndex: Map<string, number> | null; start: Int32Array }>();

  const lineCount = (v: JsonValue): number => {
    if (typeof v !== "object" || v === null) return 1;
    const memo = counts.get(v);
    if (memo !== undefined) return memo;
    const children = Array.isArray(v) ? v : objectKeys(v, sortKeys).map((k) => v[k]!);
    const n = children.length === 0 ? 1 : 2 + children.reduce<number>((sum, c) => sum + lineCount(c), 0);
    counts.set(v, n);
    return n;
  };

  /** Offset of each child's first line from the container's opening line. */
  const layout = (v: JsonValue[] | { [key: string]: JsonValue }) => {
    let l = layouts.get(v);
    if (!l) {
      const keys = Array.isArray(v) ? null : objectKeys(v, sortKeys);
      const children = keys === null ? (v as JsonValue[]) : keys.map((k) => (v as Record<string, JsonValue>)[k]!);
      const start = new Int32Array(children.length);
      let offset = 1;
      children.forEach((c, i) => {
        start[i] = offset;
        offset += lineCount(c);
      });
      l = { keyIndex: keys === null ? null : new Map(keys.map((k, i) => [k, i])), start };
      layouts.set(v, l);
    }
    return l;
  };

  return (segments) => {
    if (root === undefined) return -1;
    let cur: JsonValue = root;
    let line = 0;
    for (const seg of segments) {
      if (typeof cur !== "object" || cur === null) return -1;
      const l = layout(cur);
      const idx = l.keyIndex === null ? (seg as number) : (l.keyIndex.get(seg as string) ?? -1);
      if (idx < 0 || idx >= l.start.length) return -1;
      line += l.start[idx]!;
      cur = l.keyIndex === null ? (cur as JsonValue[])[idx]! : (cur as Record<string, JsonValue>)[seg as string]!;
    }
    return line;
  };
}

/**
 * Copy with keys inserted in sorted order, so native JSON.stringify emits them sorted.
 * Null-prototype objects keep a "__proto__" key as data instead of changing the prototype.
 */
function withSortedKeys(v: JsonValue): JsonValue {
  if (Array.isArray(v)) return v.map(withSortedKeys);
  if (!isObject(v)) return v;
  const out: { [key: string]: JsonValue } = Object.create(null);
  for (const k of Object.keys(v).sort()) out[k] = withSortedKeys(v[k]!);
  return out;
}

const canonicalCacheSorted = new WeakMap<object, string>();
const canonicalCacheRaw = new WeakMap<object, string>();

/** Memoized compact JSON with optionally sorted keys; equal values give equal strings. */
export function canonicalJson(v: JsonValue, sortKeys: boolean): string {
  if (typeof v !== "object" || v === null) return JSON.stringify(v);
  const cache = sortKeys ? canonicalCacheSorted : canonicalCacheRaw;
  const hit = cache.get(v);
  if (hit !== undefined) return hit;
  const result = JSON.stringify(sortKeys ? withSortedKeys(v) : v);
  cache.set(v, result);
  return result;
}

/**
 * Bounded preview serializer: stops as soon as `VALUE_PREVIEW + 1` characters are emitted,
 * avoiding multi-MB allocations when reporting a large added/removed subtree.
 */
function preview(v: JsonValue, sortKeys: boolean): string {
  const parts: string[] = [];
  let len = 0;
  let truncated = false;
  const emit = (s: string) => {
    if (truncated) return;
    const remaining = VALUE_PREVIEW - len;
    if (s.length > remaining) {
      parts.push(s.slice(0, remaining));
      len = VALUE_PREVIEW;
      truncated = true;
    } else {
      parts.push(s);
      len += s.length;
    }
  };
  const walk = (node: JsonValue) => {
    if (truncated) return;
    if (Array.isArray(node)) {
      emit("[");
      for (let i = 0; i < node.length && !truncated; i++) {
        if (i > 0) emit(",");
        walk(node[i]!);
      }
      emit("]");
    } else if (isObject(node)) {
      emit("{");
      const keys = objectKeys(node, sortKeys);
      for (let i = 0; i < keys.length && !truncated; i++) {
        if (i > 0) emit(",");
        emit(`${JSON.stringify(keys[i]!)}:`);
        walk(node[keys[i]!]!);
      }
      emit("}");
    } else {
      emit(JSON.stringify(node));
    }
  };
  walk(v);
  return truncated ? `${parts.join("")}…` : parts.join("");
}

function kindOf(v: JsonValue): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

interface DiffContext {
  sortKeys: boolean;
  changes: JsonChange[];
  total: number;
  lineA: (segments: readonly Segment[]) => number;
  lineB: (segments: readonly Segment[]) => number;
}

/** `segA` / `segB` are null when the value does not exist on that side. Paths and previews are computed lazily. */
function record(
  ctx: DiffContext,
  kind: JsonChange["kind"],
  oldVal: JsonValue | undefined,
  newVal: JsonValue | undefined,
  segA: readonly Segment[] | null,
  segB: readonly Segment[] | null,
): void {
  ctx.total++;
  if (ctx.changes.length >= JSON_CHANGE_LIMIT) return;
  ctx.changes.push({
    kind,
    ...(oldVal !== undefined ? { oldValue: preview(oldVal, ctx.sortKeys) } : {}),
    ...(newVal !== undefined ? { newValue: preview(newVal, ctx.sortKeys) } : {}),
    origPath: segA === null ? null : formatPath(segA),
    modPath: segB === null ? null : formatPath(segB),
    origLine: segA === null ? -1 : ctx.lineA(segA),
    modLine: segB === null ? -1 : ctx.lineB(segB),
  });
}

/** `sa` and `sb` are the current paths as mutable stacks: pushed before descending, popped after. */
function walkDiff(a: JsonValue, b: JsonValue, sa: Segment[], sb: Segment[], ctx: DiffContext): void {
  if (isObject(a) && isObject(b)) {
    const keys = objectKeys(a, ctx.sortKeys);
    for (const k of objectKeys(b, ctx.sortKeys)) if (!Object.hasOwn(a, k)) keys.push(k);
    for (const k of keys) {
      const inA = Object.hasOwn(a, k);
      const inB = Object.hasOwn(b, k);
      sa.push(k);
      sb.push(k);
      if (inA && inB) walkDiff(a[k]!, b[k]!, sa, sb, ctx);
      else if (inA) record(ctx, "removed", a[k]!, undefined, sa, null);
      else record(ctx, "added", undefined, b[k]!, null, sb);
      sa.pop();
      sb.pop();
    }
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    diffArrays(a, b, sa, sb, ctx);
    return;
  }
  const kind = kindOf(a) !== kindOf(b) ? "type" : a !== b ? "changed" : null;
  if (kind) record(ctx, kind, a, b, sa, sb);
}

/** Two elements in a gap are reported as one changed element only at or above this similarity. */
const MIN_SIMILARITY = 0.5;

/**
 * Share of equal entries between two values, from 0 to 1.
 * Objects: equal values under the same key. Arrays: equal elements at the same index.
 * Two different primitives of the same kind score the threshold, so they still pair as "changed".
 */
function similarity(a: JsonValue, b: JsonValue, sortKeys: boolean): number {
  if (isObject(a) && isObject(b)) {
    const keysA = Object.keys(a);
    const size = new Set([...keysA, ...Object.keys(b)]).size;
    if (size === 0) return 1;
    let equal = 0;
    for (const k of keysA) if (Object.hasOwn(b, k) && canonicalJson(a[k]!, sortKeys) === canonicalJson(b[k]!, sortKeys)) equal++;
    return equal / size;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const size = Math.max(a.length, b.length);
    if (size === 0) return 1;
    let equal = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (canonicalJson(a[i]!, sortKeys) === canonicalJson(b[i]!, sortKeys)) equal++;
    return equal / size;
  }
  return kindOf(a) === kindOf(b) ? MIN_SIMILARITY : 0;
}

/**
 * Arrays align like lines (hash anchors), so one inserted element is one change, not a cascade.
 * Between anchors, elements pair by content similarity (see realignGaps).
 */
function alignArray(a: JsonValue[], b: JsonValue[], sortKeys: boolean): { pairs: RowPair[]; exact: (p: RowPair) => boolean } {
  const refs = (arr: JsonValue[]): RowRef[] =>
    arr.map((v, index) => {
      const sig = canonicalJson(v, sortKeys);
      return { index, sig, hash: cyrb53(sig) };
    });
  const ra = refs(a);
  const rb = refs(b);
  const exact = (p: RowPair) => p.orig !== -1 && p.mod !== -1 && ra[p.orig]!.sig === rb[p.mod]!.sig;
  const pairs = realignGaps(alignBySequence(ra, rb), exact, {
    similarity: (i, j) => similarity(a[i]!, b[j]!, sortKeys),
    minSimilarity: MIN_SIMILARITY,
    cellLimit: 4096,
  });
  return { pairs, exact };
}

function diffArrays(a: JsonValue[], b: JsonValue[], sa: Segment[], sb: Segment[], ctx: DiffContext): void {
  const { pairs, exact } = alignArray(a, b, ctx.sortKeys);
  for (const p of pairs) {
    const { orig, mod } = p;
    if (orig !== -1 && mod !== -1) {
      if (exact(p)) continue;
      sa.push(orig);
      sb.push(mod);
      walkDiff(a[orig]!, b[mod]!, sa, sb, ctx);
      sa.pop();
      sb.pop();
    } else if (orig !== -1) {
      record(ctx, "removed", a[orig]!, undefined, [...sa, orig], null);
    } else {
      record(ctx, "added", undefined, b[mod]!, null, [...sb, mod]);
    }
  }
}

/**
 * Structural differences between two JSON documents. `undefined` means the side is empty:
 * the whole other document is reported as added or removed.
 */
export function diffJson(
  a: JsonValue | undefined,
  b: JsonValue | undefined,
  opts: { sortKeys: boolean },
): { changes: JsonChange[]; total: number } {
  const ctx: DiffContext = {
    sortKeys: opts.sortKeys,
    changes: [],
    total: 0,
    lineA: lineResolver(a, opts.sortKeys),
    lineB: lineResolver(b, opts.sortKeys),
  };
  if (a === undefined && b === undefined) return { changes: [], total: 0 };
  if (a === undefined) record(ctx, "added", undefined, b!, null, []);
  else if (b === undefined) record(ctx, "removed", a, undefined, [], null);
  else walkDiff(a, b, [], [], ctx);
  return { changes: ctx.changes, total: ctx.total };
}

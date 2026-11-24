/**
 * Row alignment: decide which original row pairs with which modified row.
 * Every function returns pairs in display order; -1 marks a missing side.
 * None of these compare cells; diffSheet does that for each pair afterwards.
 */

export interface RowRef {
  /** Row index in SheetData.rows. */
  index: number;
  hash: number;
  sig: string;
}

export interface KeyedRowRef {
  index: number;
  key: string;
}

export interface RowPair {
  orig: number;
  mod: number;
}

/** Regions up to this many cells (p × q) get an exact LCS; larger ones pair by position. */
const LCS_CELL_LIMIT = 1_000_000;

const same = (x: RowRef, y: RowRef): boolean => x.hash === y.hash && x.sig === y.sig;

/* ----------------------------------------------------------- index matching */

/** Row N pairs with row N. Both inputs must be sorted by index. */
export function alignByIndex(a: RowRef[], b: RowRef[]): RowPair[] {
  const out: RowPair[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const ai = a[i];
    const bj = b[j];
    if (ai && bj && ai.index === bj.index) {
      out.push({ orig: ai.index, mod: bj.index });
      i++;
      j++;
    } else if (ai && (!bj || ai.index < bj.index)) {
      out.push({ orig: ai.index, mod: -1 });
      i++;
    } else if (bj) {
      out.push({ orig: -1, mod: bj.index });
      j++;
    }
  }
  return out;
}

/* ------------------------------------------------------------- key matching */

/**
 * Rows pair when their key values are equal. The k-th occurrence of a duplicate
 * key in the original pairs with the k-th occurrence in the modified file.
 * Output follows modified order; each removed row appears before the first
 * pair whose original index is greater than its own.
 */
export function alignByKey(a: KeyedRowRef[], b: KeyedRowRef[]): RowPair[] {
  const queues = new Map<string, number[]>();
  for (const ref of a) {
    const q = queues.get(ref.key);
    if (q) q.push(ref.index);
    else queues.set(ref.key, [ref.index]);
  }
  const heads = new Map<string, number>();
  const used = new Set<number>();
  const matched: RowPair[] = [];
  for (const ref of b) {
    const q = queues.get(ref.key);
    const h = heads.get(ref.key) ?? 0;
    const origIndex = q?.[h];
    if (origIndex !== undefined) {
      heads.set(ref.key, h + 1);
      used.add(origIndex);
      matched.push({ orig: origIndex, mod: ref.index });
    } else {
      matched.push({ orig: -1, mod: ref.index });
    }
  }
  const removed = a.filter((ref) => !used.has(ref.index)).map((ref) => ref.index);

  const out: RowPair[] = [];
  let r = 0;
  for (const pair of matched) {
    if (pair.orig !== -1) {
      while (r < removed.length && removed[r]! < pair.orig) out.push({ orig: removed[r++]!, mod: -1 });
    }
    out.push(pair);
  }
  while (r < removed.length) out.push({ orig: removed[r++]!, mod: -1 });
  return out;
}

/* -------------------------------------------------------- aligned matching */

type Task =
  | { kind: "region"; a0: number; a1: number; b0: number; b1: number }
  | { kind: "pair"; i: number; j: number }
  | { kind: "run"; a0: number; b0: number; len: number };

/**
 * Order-preserving alignment (patience diff over row hashes):
 * 1. Emit the common prefix and suffix.
 * 2. Anchor rows whose hash is unique in both middles; keep the longest
 *    increasing run of anchors; recurse between anchors.
 * 3. A region without anchors (or once the anchor-scan budget is spent) gets an
 *    exact LCS when small, else pairs by position.
 * Iterative (explicit stack) so 50k-row sheets cannot overflow the call stack.
 */
export function alignBySequence(a: RowRef[], b: RowRef[]): RowPair[] {
  const out: RowPair[] = [];
  const emit = (i: number, j: number): void => {
    out.push({ orig: i < 0 ? -1 : a[i]!.index, mod: j < 0 ? -1 : b[j]!.index });
  };
  const stack: Task[] = [{ kind: "region", a0: 0, a1: a.length, b0: 0, b1: b.length }];
  // Cap cumulative anchor-scan work to O(N log N) to prevent O(N²) edge-peeling DoS.
  const totalN = a.length + b.length;
  let scanBudget = Math.max(8_192, Math.ceil(totalN * (Math.log2(Math.max(2, totalN)) + 4)));

  while (stack.length > 0) {
    const task = stack.pop()!;
    if (task.kind === "pair") {
      emit(task.i, task.j);
      continue;
    }
    if (task.kind === "run") {
      for (let k = 0; k < task.len; k++) emit(task.a0 + k, task.b0 + k);
      continue;
    }
    let { a0, b0 } = task;
    const { a1, b1 } = task;

    while (a0 < a1 && b0 < b1 && same(a[a0]!, b[b0]!)) emit(a0++, b0++);
    let s = 0;
    while (a1 - s > a0 && b1 - s > b0 && same(a[a1 - 1 - s]!, b[b1 - 1 - s]!)) s++;
    // The suffix is emitted after the middle, so push it as one run task.
    if (s > 0) stack.push({ kind: "run", a0: a1 - s, b0: b1 - s, len: s });
    const ma1 = a1 - s;
    const mb1 = b1 - s;

    if (a0 === ma1 || b0 === mb1) {
      for (let i = a0; i < ma1; i++) emit(i, -1);
      for (let j = b0; j < mb1; j++) emit(-1, j);
      continue;
    }

    const span = (ma1 - a0) + (mb1 - b0);
    if (scanBudget < span) {
      fallbackAlign(a, b, a0, ma1, b0, mb1, emit);
      continue;
    }
    scanBudget -= span;

    const anchors = uniqueAnchors(a, b, a0, ma1, b0, mb1);
    if (anchors.length === 0) {
      fallbackAlign(a, b, a0, ma1, b0, mb1, emit);
      continue;
    }
    // Push sub-tasks in reverse so they pop in display order.
    let endA = ma1;
    let endB = mb1;
    for (let k = anchors.length - 1; k >= 0; k--) {
      const [i, j] = anchors[k]!;
      stack.push({ kind: "region", a0: i + 1, a1: endA, b0: j + 1, b1: endB });
      stack.push({ kind: "pair", i, j });
      endA = i;
      endB = j;
    }
    stack.push({ kind: "region", a0, a1: endA, b0, b1: endB });
  }
  return out;
}

/** Pairs (i, j) of rows unique in both ranges, reduced to their longest increasing subsequence. */
function uniqueAnchors(
  a: RowRef[],
  b: RowRef[],
  a0: number,
  a1: number,
  b0: number,
  b1: number,
): Array<[number, number]> {
  const seen = new Map<number, { countA: number; i: number; countB: number; j: number }>();
  for (let i = a0; i < a1; i++) {
    const h = a[i]!.hash;
    const e = seen.get(h);
    if (e) e.countA++;
    else seen.set(h, { countA: 1, i, countB: 0, j: -1 });
  }
  for (let j = b0; j < b1; j++) {
    const e = seen.get(b[j]!.hash);
    if (e) {
      e.countB++;
      e.j = j;
    }
  }
  const candidates: Array<[number, number]> = [];
  for (const e of seen.values()) {
    if (e.countA === 1 && e.countB === 1 && a[e.i]!.sig === b[e.j]!.sig) candidates.push([e.i, e.j]);
  }
  candidates.sort((x, y) => x[0] - y[0]);
  return longestIncreasingByJ(candidates);
}

/** O(k log k) LIS on the second element; input sorted by the first element. */
function longestIncreasingByJ(pairs: Array<[number, number]>): Array<[number, number]> {
  const tails: number[] = []; // index into pairs of the smallest tail for each length
  const prev = new Int32Array(pairs.length).fill(-1);
  for (let p = 0; p < pairs.length; p++) {
    const j = pairs[p]![1];
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]!]![1] < j) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[p] = tails[lo - 1]!;
    tails[lo] = p;
  }
  const result: Array<[number, number]> = [];
  let p = tails.length > 0 ? tails[tails.length - 1]! : -1;
  while (p !== -1) {
    result.push(pairs[p]!);
    p = prev[p]!;
  }
  return result.reverse();
}

/** Region with no unique anchors: exact LCS when small, then pair the gaps by position. */
function fallbackAlign(
  a: RowRef[],
  b: RowRef[],
  a0: number,
  a1: number,
  b0: number,
  b1: number,
  emit: (i: number, j: number) => void,
): void {
  const p = a1 - a0;
  const q = b1 - b0;
  if (p * q > LCS_CELL_LIMIT) {
    pairGap(a0, a1, b0, b1, emit);
    return;
  }
  // dp[i][j] = LCS length of a[a0+i..a1) and b[b0+j..b1), stored row-major.
  const w = q + 1;
  const dp = new Uint32Array((p + 1) * w);
  for (let i = p - 1; i >= 0; i--) {
    for (let j = q - 1; j >= 0; j--) {
      dp[i * w + j] = same(a[a0 + i]!, b[b0 + j]!)
        ? dp[(i + 1) * w + j + 1]! + 1
        : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!);
    }
  }
  let i = 0;
  let j = 0;
  let gi = 0;
  let gj = 0;
  while (i < p && j < q) {
    if (same(a[a0 + i]!, b[b0 + j]!)) {
      pairGap(a0 + gi, a0 + i, b0 + gj, b0 + j, emit);
      emit(a0 + i, b0 + j);
      i++;
      j++;
      gi = i;
      gj = j;
    } else if (dp[(i + 1) * w + j]! >= dp[i * w + j + 1]!) i++;
    else j++;
  }
  pairGap(a0 + gi, a1, b0 + gj, b1, emit);
}

/** Pair rows of a gap by position; the longer side's leftovers become removed/added. */
function pairGap(a0: number, a1: number, b0: number, b1: number, emit: (i: number, j: number) => void): void {
  const k = Math.min(a1 - a0, b1 - b0);
  for (let t = 0; t < k; t++) emit(a0 + t, b0 + t);
  for (let i = a0 + k; i < a1; i++) emit(i, -1);
  for (let j = b0 + k; j < b1; j++) emit(-1, j);
}

export interface GapPairing {
  /** Similarity of two items from 0 to 1; called only for items inside one gap. */
  similarity: (orig: number, mod: number) => number;
  /** Items pair only at or above this similarity; below it they become a removal plus an addition. */
  minSimilarity: number;
  /** Gaps with more candidate pairs than this keep the positional pairing. */
  cellLimit: number;
}

/**
 * Order-preserving pairing of the items in one gap that maximizes total similarity
 * (weighted LCS). `origIdx` / `modIdx` are item indexes in ascending order.
 */
export function pairBySimilarity(origIdx: number[], modIdx: number[], opts: GapPairing): RowPair[] {
  const n = origIdx.length;
  const m = modIdx.length;
  const w = m + 1;
  const score = new Float64Array((n + 1) * w);
  const sim = new Float64Array(n * m);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const s = opts.similarity(origIdx[i - 1]!, modIdx[j - 1]!);
      sim[(i - 1) * m + (j - 1)] = s;
      const diag = s >= opts.minSimilarity ? score[(i - 1) * w + (j - 1)]! + s : -1;
      score[i * w + j] = Math.max(score[(i - 1) * w + j]!, score[i * w + (j - 1)]!, diag);
    }
  }
  const out: RowPair[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const s = i > 0 && j > 0 ? sim[(i - 1) * m + (j - 1)]! : 0;
    if (i > 0 && j > 0 && s >= opts.minSimilarity && score[i * w + j] === score[(i - 1) * w + (j - 1)]! + s) {
      out.push({ orig: origIdx[--i]!, mod: modIdx[--j]! });
    } else if (j > 0 && (i === 0 || score[i * w + j] === score[i * w + (j - 1)])) {
      out.push({ orig: -1, mod: modIdx[--j]! });
    } else {
      out.push({ orig: origIdx[--i]!, mod: -1 });
    }
  }
  return out.reverse();
}

/**
 * Re-pair the stretches between exact matches by content similarity, so an edited item next
 * to an inserted one pairs with its real counterpart instead of whatever sits at the same offset.
 * `exact` marks the pairs to keep as anchors.
 */
export function realignGaps(pairs: RowPair[], exact: (p: RowPair) => boolean, opts: GapPairing): RowPair[] {
  const out: RowPair[] = [];
  let gapA: number[] = [];
  let gapB: number[] = [];
  const flush = () => {
    if (gapA.length > 0 && gapB.length > 0 && gapA.length * gapB.length <= opts.cellLimit) {
      out.push(...pairBySimilarity(gapA, gapB, opts));
    } else {
      // One-sided, or too large to score every pair: keep the positional pairing.
      const k = Math.min(gapA.length, gapB.length);
      for (let t = 0; t < k; t++) out.push({ orig: gapA[t]!, mod: gapB[t]! });
      for (let t = k; t < gapA.length; t++) out.push({ orig: gapA[t]!, mod: -1 });
      for (let t = k; t < gapB.length; t++) out.push({ orig: -1, mod: gapB[t]! });
    }
    gapA = [];
    gapB = [];
  };
  for (const p of pairs) {
    if (exact(p)) {
      flush();
      out.push(p);
      continue;
    }
    if (p.orig !== -1) gapA.push(p.orig);
    if (p.mod !== -1) gapB.push(p.mod);
  }
  flush();
  return out;
}

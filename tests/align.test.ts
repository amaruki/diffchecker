import { describe, expect, test } from "bun:test";
import { alignByIndex, alignByKey, alignBySequence, type RowRef } from "../src/core/align";
import { cyrb53 } from "../src/core/hash";

const refs = (sigs: string[]): RowRef[] => sigs.map((sig, index) => ({ index, sig, hash: cyrb53(sig) }));
const pairs = (a: string[], b: string[]) => alignBySequence(refs(a), refs(b)).map((p) => [p.orig, p.mod]);

describe("alignBySequence", () => {
  test("empty inputs", () => {
    expect(pairs([], [])).toEqual([]);
    expect(pairs(["a"], [])).toEqual([[0, -1]]);
    expect(pairs([], ["a"])).toEqual([[-1, 0]]);
  });

  test("insertion and deletion keep the rest aligned", () => {
    expect(pairs(["a", "b", "c", "d"], ["a", "x", "b", "d"])).toEqual([
      [0, 0],
      [-1, 1],
      [1, 2],
      [2, -1],
      [3, 3],
    ]);
  });

  test("completely different rows pair by position", () => {
    expect(pairs(["a", "b"], ["x", "y", "z"])).toEqual([
      [0, 0],
      [1, 1],
      [-1, 2],
    ]);
  });

  test("moved block keeps the longest in-order run", () => {
    const out = pairs(["a", "b", "c", "d", "e"], ["c", "d", "e", "a", "b"]);
    const matched = out.filter(([o, m]) => o !== -1 && m !== -1);
    expect(matched).toContainEqual([2, 0]);
    expect(matched).toContainEqual([3, 1]);
    expect(matched).toContainEqual([4, 2]);
  });

  test("hash collision never pairs unequal rows as equal", () => {
    const a: RowRef[] = [{ index: 0, sig: "one", hash: 1 }];
    const b: RowRef[] = [{ index: 0, sig: "two", hash: 1 }];
    // Same hash, different signature: they may pair positionally, and diffSheet then compares cells.
    expect(alignBySequence(a, b)).toEqual([{ orig: 0, mod: 0 }]);
  });

  test("50k rows with 100 inserts and 100 deletes", () => {
    const base = Array.from({ length: 50_000 }, (_, i) => `row-${i}`);
    const mod = [...base];
    for (let k = 0; k < 100; k++) mod.splice(k * 400 + 7, 1);
    for (let k = 0; k < 100; k++) mod.splice(k * 450 + 3, 0, `new-${k}`);
    const out = alignBySequence(refs(base), refs(mod));
    const removed = out.filter((p) => p.mod === -1).length;
    const added = out.filter((p) => p.orig === -1).length;
    const paired = out.filter((p) => p.orig !== -1 && p.mod !== -1);
    expect(paired.every((p) => base[p.orig] === mod[p.mod])).toBe(true);
    expect([removed, added, paired.length]).toEqual([100, 100, 49_900]);
  });
});

describe("alignByIndex", () => {
  test("pairs equal indexes and reports the tail", () => {
    const a: RowRef[] = [0, 1, 2].map((index) => ({ index, sig: "", hash: 0 }));
    const b: RowRef[] = [0, 2, 3].map((index) => ({ index, sig: "", hash: 0 }));
    expect(alignByIndex(a, b).map((p) => [p.orig, p.mod])).toEqual([
      [0, 0],
      [1, -1],
      [2, 2],
      [-1, 3],
    ]);
  });
});

describe("alignByKey", () => {
  test("removed rows appear near their original position", () => {
    const a = ["k1", "k2", "k3"].map((key, index) => ({ index, key }));
    const b = ["k1", "k3"].map((key, index) => ({ index, key }));
    expect(alignByKey(a, b).map((p) => [p.orig, p.mod])).toEqual([
      [0, 0],
      [1, -1],
      [2, 1],
    ]);
  });
});

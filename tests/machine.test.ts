import { describe, expect, test } from "bun:test";
import type { PackedWorkbook, PackedWorkbookDiff } from "../src/core/pack";
import { canSwap, INITIAL_STATE, reducer, transition, type AppEvent, type AppState } from "../src/state/machine";

const wb = { fileName: "x.xlsx", sheets: [] } as PackedWorkbook;
const diff = { sheets: [], identical: true } as unknown as PackedWorkbookDiff;

function run(...events: AppEvent[]): AppState {
  return events.reduce(reducer, INITIAL_STATE);
}

const bothReady: AppEvent[] = [
  { type: "FILE_SELECTED", side: "original", fileName: "a.xlsx", requestId: 1 },
  { type: "FILE_SELECTED", side: "modified", fileName: "b.xlsx", requestId: 2 },
  { type: "PARSE_SUCCEEDED", side: "original", requestId: 1, workbook: wb, parseMs: 1 },
  { type: "PARSE_SUCCEEDED", side: "modified", requestId: 2, workbook: wb, parseMs: 1 },
];

describe("state machine", () => {
  test("happy path: select, parse, diff", () => {
    const s = run(...bothReady, { type: "DIFF_STARTED", requestId: 3 }, { type: "DIFF_SUCCEEDED", requestId: 3, diff, diffMs: 5 });
    expect(s.original.status).toBe("ready");
    expect(s.modified.status).toBe("ready");
    expect(s.comparison).toEqual({ status: "done", diff, diffMs: 5 });
  });

  test("rejects a diff before both files are ready", () => {
    expect(transition(INITIAL_STATE, { type: "DIFF_STARTED", requestId: 1 })).toBeNull();
  });

  test("ignores a stale parse result after the file was replaced", () => {
    const s = run(
      { type: "FILE_SELECTED", side: "original", fileName: "a.xlsx", requestId: 1 },
      { type: "FILE_SELECTED", side: "original", fileName: "a2.xlsx", requestId: 2 },
    );
    expect(transition(s, { type: "PARSE_SUCCEEDED", side: "original", requestId: 1, workbook: wb, parseMs: 1 })).toBeNull();
    const next = transition(s, { type: "PARSE_SUCCEEDED", side: "original", requestId: 2, workbook: wb, parseMs: 1 });
    expect(next?.original).toMatchObject({ status: "ready", fileName: "a2.xlsx" });
  });

  test("ignores a stale diff result", () => {
    const s = run(...bothReady, { type: "DIFF_STARTED", requestId: 3 }, { type: "DIFF_STARTED", requestId: 4 });
    expect(transition(s, { type: "DIFF_SUCCEEDED", requestId: 3, diff, diffMs: 1 })).toBeNull();
  });

  test("parse failure moves the slot to failed", () => {
    const s = run(
      { type: "FILE_SELECTED", side: "modified", fileName: "bad.xlsx", requestId: 1 },
      { type: "PARSE_FAILED", side: "modified", requestId: 1, error: "corrupted" },
    );
    expect(s.modified).toEqual({ status: "failed", fileName: "bad.xlsx", error: "corrupted" });
  });

  test("a slot leaving ready resets the comparison to idle", () => {
    const done = run(...bothReady, { type: "DIFF_STARTED", requestId: 3 }, { type: "DIFF_SUCCEEDED", requestId: 3, diff, diffMs: 1 });
    expect(reducer(done, { type: "FILE_CLEARED", side: "original" }).comparison.status).toBe("idle");
    expect(reducer(done, { type: "FILE_SELECTED", side: "modified", fileName: "c.xlsx", requestId: 9 }).comparison.status).toBe("idle");
  });

  test("clearing an empty slot is rejected", () => {
    expect(transition(INITIAL_STATE, { type: "FILE_CLEARED", side: "original" })).toBeNull();
  });

  test("parse result for a slot that is not parsing is rejected", () => {
    expect(transition(INITIAL_STATE, { type: "PARSE_FAILED", side: "original", requestId: 1, error: "x" })).toBeNull();
  });

  test("swap exchanges the slots and resets the comparison", () => {
    const done = run(...bothReady, { type: "DIFF_STARTED", requestId: 3 }, { type: "DIFF_SUCCEEDED", requestId: 3, diff, diffMs: 5 });
    const s = transition(done, { type: "SWAPPED" });
    expect(s?.original).toMatchObject({ fileName: "b.xlsx" });
    expect(s?.modified).toMatchObject({ fileName: "a.xlsx" });
    expect(s?.comparison).toEqual({ status: "idle" });
  });

  test("swap is rejected while a file parses or when both slots are empty", () => {
    expect(canSwap(INITIAL_STATE)).toBe(false);
    expect(transition(INITIAL_STATE, { type: "SWAPPED" })).toBeNull();
    const parsing = run({ type: "FILE_SELECTED", side: "original", fileName: "a.xlsx", requestId: 1 });
    expect(transition(parsing, { type: "SWAPPED" })).toBeNull();
  });
});

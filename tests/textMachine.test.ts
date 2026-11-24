import { describe, expect, test } from "bun:test";
import { INITIAL_TEXT_STATE, isComparable, textReducer, transitionText, type TextEvent, type TextState } from "../src/state/textMachine";
import type { PackedTextDiff } from "../src/text/pack";

const diff = { identical: false } as PackedTextDiff;
const run = (...events: TextEvent[]): TextState => events.reduce(textReducer, INITIAL_TEXT_STATE);

describe("text state machine", () => {
  test("typing makes a slot ready; clearing the text empties it", () => {
    const s = run({ type: "TEXT_EDITED", side: "original", text: "abc" });
    expect(s.original).toEqual({ status: "ready", text: "abc", fileName: null });
    expect(textReducer(s, { type: "TEXT_EDITED", side: "original", text: "" }).original.status).toBe("empty");
  });

  test("comparable only when both sides hold text", () => {
    expect(isComparable(INITIAL_TEXT_STATE)).toBe(false);
    expect(transitionText(INITIAL_TEXT_STATE, { type: "DIFF_STARTED", requestId: 1 })).toBeNull();
    const one = run({ type: "TEXT_EDITED", side: "modified", text: "x" });
    expect(isComparable(one)).toBe(false);
    expect(transitionText(one, { type: "DIFF_STARTED", requestId: 1 })).toBeNull();
    expect(isComparable(textReducer(one, { type: "TEXT_EDITED", side: "original", text: "y" }))).toBe(true);
  });

  test("file read: stale results are rejected", () => {
    const s = run(
      { type: "FILE_SELECTED", side: "original", fileName: "a.json", requestId: 1 },
      { type: "FILE_SELECTED", side: "original", fileName: "b.json", requestId: 2 },
    );
    expect(transitionText(s, { type: "FILE_READ_SUCCEEDED", side: "original", requestId: 1, text: "old" })).toBeNull();
    const next = textReducer(s, { type: "FILE_READ_SUCCEEDED", side: "original", requestId: 2, text: "{}" });
    expect(next.original).toEqual({ status: "ready", text: "{}", fileName: "b.json" });
  });

  test("a reading or failed slot blocks comparison and resets it to idle", () => {
    const done = run(
      { type: "TEXT_EDITED", side: "original", text: "a" },
      { type: "TEXT_EDITED", side: "modified", text: "b" },
      { type: "DIFF_STARTED", requestId: 1 },
      { type: "DIFF_SUCCEEDED", requestId: 1, diff, diffMs: 1 },
    );
    expect(done.comparison.status).toBe("done");
    const reading = textReducer(done, { type: "FILE_SELECTED", side: "modified", fileName: "x.txt", requestId: 5 });
    expect(reading.comparison.status).toBe("idle");
    const failed = textReducer(reading, { type: "FILE_READ_FAILED", side: "modified", requestId: 5, error: "binary" });
    expect(failed.modified).toEqual({ status: "failed", fileName: "x.txt", error: "binary" });
    expect(transitionText(failed, { type: "DIFF_STARTED", requestId: 2 })).toBeNull();
  });

  test("a new diff keeps the previous result for display; stale results are ignored", () => {
    const s = run(
      { type: "TEXT_EDITED", side: "original", text: "a" },
      { type: "TEXT_EDITED", side: "modified", text: "b" },
      { type: "DIFF_STARTED", requestId: 1 },
      { type: "DIFF_SUCCEEDED", requestId: 1, diff, diffMs: 3 },
      { type: "TEXT_EDITED", side: "original", text: "ab" },
      { type: "DIFF_STARTED", requestId: 2 },
    );
    expect(s.comparison).toEqual({ status: "running", requestId: 2, previous: { diff, diffMs: 3 } });
    expect(transitionText(s, { type: "DIFF_SUCCEEDED", requestId: 1, diff, diffMs: 1 })).toBeNull();
  });

  test("swap exchanges slots and is rejected while a file is reading", () => {
    const s = run({ type: "TEXT_EDITED", side: "original", text: "left" }, { type: "TEXT_EDITED", side: "modified", text: "right" });
    const swapped = textReducer(s, { type: "SWAPPED" });
    expect(swapped.original).toMatchObject({ text: "right" });
    expect(swapped.modified).toMatchObject({ text: "left" });
    const reading = textReducer(s, { type: "FILE_SELECTED", side: "original", fileName: "f", requestId: 1 });
    expect(transitionText(reading, { type: "SWAPPED" })).toBeNull();
  });

  test("clearing an empty slot is rejected", () => {
    expect(transitionText(INITIAL_TEXT_STATE, { type: "CLEARED", side: "modified" })).toBeNull();
  });
});

import { describe, expect, test } from "bun:test";
import { alignBySequence, type RowRef } from "../src/core/align";
import { diffSheetContents } from "../src/core/diffSheet";
import { diffWorkbooks } from "../src/core/diffWorkbook";
import { packSheet, packWorkbook, packWorkbookDiff, type PackedWorkbook, type PackedWorkbookDiff } from "../src/core/pack";
import { MAX_UNCOMPRESSED_BYTES, MAX_WORKBOOK_BYTES, parseWorkbook, WorkbookParseError } from "../src/core/parse";
import { DEFAULT_OPTIONS, type Row } from "../src/core/types";
import { captureWorkbookReport } from "../src/core/workbookReport";
import { INITIAL_STATE, reducer, transition } from "../src/state/machine";
import { decodeWorkbookReport, encodeWorkbookReport, isValidWorkbookReport } from "../src/state/reportEncoding";
import { decodeWorkbook, listLegacyComparisons, readLegacyComparison, SAVED_COMPARISON_PREFIX } from "../src/state/savedComparisons";
import { INITIAL_TEXT_STATE, textReducer, transitionText } from "../src/state/textMachine";
import { sanitizeSummary, WORKBOOK_KEY_PREFIX } from "../src/state/workbookHistory";
import { decodeText, TextDecodeError } from "../src/text/decode";
import { diffTexts } from "../src/text/diffText";
import { inlineDiff } from "../src/text/inline";
import { exceedsJsonDepth, exceedsRawJsonDepth, MAX_JSON_DEPTH } from "../src/text/json";
import { DEFAULT_TEXT_OPTIONS } from "../src/text/types";
import { cellAddress, columnName, MAX_COLUMN_INDEX, parseColumnName } from "../src/ui/columns";
import { lowerBound, upperBound } from "../src/ui/navigation";
import { syncScroll } from "../src/ui/scrollSync";
import { book, sheet } from "./helpers";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => Array.from(map.keys())[index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, value),
  };
}

/** Build a minimal synthetic ZIP with custom entry name and declared uncompressed size in its Central Directory. */
function fakeZip(entryName: string, uncompressedSize: number): ArrayBuffer {
  const nameBytes = new TextEncoder().encode(entryName);
  const localSize = 30 + nameBytes.length;
  const cdSize = 46 + nameBytes.length;
  const total = localSize + cdSize + 22;
  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  // Local file header
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(26, nameBytes.length, true);
  bytes.set(nameBytes, 30);
  // Central Directory header
  const cd = localSize;
  view.setUint32(cd, 0x02014b50, true);
  view.setUint32(cd + 24, uncompressedSize, true);
  view.setUint16(cd + 28, nameBytes.length, true);
  bytes.set(nameBytes, cd + 46);
  // EOCD
  const eocd = cd + cdSize;
  view.setUint32(eocd, 0x06054b50, true);
  view.setUint16(eocd + 8, 1, true);
  view.setUint16(eocd + 10, 1, true);
  view.setUint32(eocd + 12, cdSize, true);
  view.setUint32(eocd + 16, cd, true);
  return buf;
}

describe("parseWorkbook hardening", () => {
  test("rejects oversized buffers before SheetJS runs", () => {
    const oversized = new ArrayBuffer(MAX_WORKBOOK_BYTES + 1);
    expect(() => parseWorkbook(oversized, "huge.xlsx")).toThrow(WorkbookParseError);
    expect(() => parseWorkbook(oversized, "huge.xlsx")).toThrow(/limit is 100 MB/i);
  });

  test("rejects ZIP decompression bombs via Central Directory pre-flight check", () => {
    const bomb = fakeZip("[Content_Types].xml", MAX_UNCOMPRESSED_BYTES + 1024);
    expect(() => parseWorkbook(bomb, "bomb.xlsx")).toThrow(/safety limit/i);
  });

  test("rejects non-OOXML ZIP archives missing [Content_Types].xml", () => {
    const plainZip = fakeZip("hello.txt", 12);
    expect(() => parseWorkbook(plainZip, "not-xlsx.xlsx")).toThrow(/\[Content_Types\]\.xml/i);
  });
});

describe("spreadsheet diff correctness & DoS guards", () => {
  test("rowSignature resists delimiter collisions across columns", () => {
    const a = sheet("S", [["foo\u00021\u0001s:bar"]]);
    const b = sheet("S", [["foo", "bar"]]);
    const d = diffSheetContents(a, b, DEFAULT_OPTIONS);
    expect(d.counts.changedRows).toBe(1);
    expect(d.rows[0]?.status).toBe("changed");
  });

  test("handles wide sparse rows (single cell at XFD) without dense scanning stall", () => {
    const makeWide = (val: number) => {
      const rows: Row[] = Array.from({ length: 2_000 }, (_, r) => {
        const row: Row = [];
        row[16_383] = { type: "n", value: r + val, text: String(r + val) };
        return row;
      });
      return { name: "Wide", rows, colCount: 16_384, merges: [] };
    };
    const start = performance.now();
    const a = makeWide(0);
    const b = makeWide(1);
    const packed = packSheet(a);
    const d = diffSheetContents(a, b, DEFAULT_OPTIONS);
    const elapsed = performance.now() - start;
    expect(packed.grid.cols[0]).toBe(16_383);
    expect(d.counts.addedRows + d.counts.removedRows + d.counts.changedRows).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(500);
  });

  test("alignBySequence defends against O(N²) edge-peeling inputs via scan budget", () => {
    const k = 4_000;
    const a: RowRef[] = [];
    const b: RowRef[] = [{ index: 0, hash: 999999, sig: "Z0" }];
    for (let i = 1; i <= k; i++) {
      a.push({ index: a.length, hash: i + 1, sig: `U_${i + 1}` });
      a.push({ index: a.length, hash: i, sig: `U_${i}` });
      b.push({ index: b.length, hash: i, sig: `U_${i}` });
    }
    b.push({ index: b.length, hash: 999998, sig: "Z1" });
    const start = performance.now();
    const pairs = alignBySequence(a, b);
    const elapsed = performance.now() - start;
    expect(pairs.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(500);
  });

  test("does not falsely pair unrelated empty sheets as renamed", () => {
    const d = diffWorkbooks(book(sheet("Notes", [])), book(sheet("Q4 Budget", [])), DEFAULT_OPTIONS);
    expect(d.totals.renamedSheets).toBe(0);
    expect(d.totals.removedSheets).toBe(1);
    expect(d.totals.addedSheets).toBe(1);
  });

  test("matches duplicate sheet names 1-to-1 instead of reusing modIndex", () => {
    const d = diffWorkbooks(
      book(sheet("Dup", [["a"]]), sheet("Dup", [["b"]])),
      book(sheet("Dup", [["a"]])),
      DEFAULT_OPTIONS,
    );
    const matched = d.sheets.filter((s) => s.status === "matched");
    expect(matched.length).toBe(1);
    expect(d.totals.removedSheets).toBe(1);
  });
});

describe("JSON & text engine hardening", () => {
  test("detects raw and parsed nesting deeper than MAX_JSON_DEPTH without stack overflow", () => {
    const huge = "[".repeat(50_000) + "1" + "]".repeat(50_000);
    expect(exceedsRawJsonDepth(huge, MAX_JSON_DEPTH)).toBe(true);
    // Brackets inside string literals do not count toward nesting depth.
    expect(exceedsRawJsonDepth(`{"s":"${"[".repeat(500)}"}`, MAX_JSON_DEPTH)).toBe(false);

    let deep: unknown = 1;
    for (let i = 0; i < MAX_JSON_DEPTH + 10; i++) deep = [deep];
    expect(exceedsJsonDepth(deep as never, MAX_JSON_DEPTH)).toBe(true);
  });

  test("falls back cleanly to plain text with depth warning even for 50k-deep JSON", () => {
    const orig = "[".repeat(50_000) + "1" + "]".repeat(50_000);
    const mod = "[".repeat(50_000) + "2" + "]".repeat(50_000);
    const res = diffTexts(
      { name: "orig.json", text: orig },
      { name: "mod.json", text: mod },
      { ...DEFAULT_TEXT_OPTIONS, format: "json" },
    );
    expect(res.format).toBe("text");
    expect(res.json).toBeNull();
    expect(res.notes.some((n) => n.level === "warning" && /deeper than/i.test(n.message))).toBe(true);
  });

  test("decodeText rejects UTF-32 BOMs and UTF-16 binary NUL code units", () => {
    expect(() => decodeText(new Uint8Array([0xff, 0xfe, 0x00, 0x00, 0x41, 0x00, 0x00, 0x00]))).toThrow(TextDecodeError);
    expect(() => decodeText(new Uint8Array([0x00, 0x00, 0xfe, 0xff]))).toThrow(/UTF-32/i);
    expect(() => decodeText(new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x00, 0x00]))).toThrow(/binary/i);
  });

  test("trailing-newline-only difference reports accurate note and ignoreWhitespace trims inline highlights", () => {
    const res = diffTexts({ name: "a.txt", text: "hello\n" }, { name: "b.txt", text: "hello" }, DEFAULT_TEXT_OPTIONS);
    expect(res.identical).toBe(true);
    expect(res.notes[0]?.message).toMatch(/trailing newline/i);

    const ws = diffTexts(
      { name: "a.txt", text: "   alpha beta" },
      { name: "b.txt", text: "alpha gamma   " },
      { ...DEFAULT_TEXT_OPTIONS, ignoreWhitespace: true },
    );
    expect(ws.rows[0]?.hlOrig).toEqual([[9, 13]]);
    expect(ws.rows[0]?.hlMod).toEqual([[6, 11]]);
  });

  test("inlineDiff handles huge single-line strings quickly without regex tokenization", () => {
    const prefix = "a".repeat(60_000);
    const start = performance.now();
    const hl = inlineDiff(prefix + "X" + prefix, prefix + "Y" + prefix, (t) => t);
    expect(performance.now() - start).toBeLessThan(100);
    expect(hl.a).toEqual([[60_000, 60_001]]);
    expect(hl.b).toEqual([[60_000, 60_001]]);
  });
});

describe("workbook report truncation, gzip bomb defense & runtime validation", () => {
  test("caps recorded changes per sheet and round-trips truncated report", async () => {
    const orig = book(sheet("Big", Array.from({ length: 20 }, (_, i) => [`row-${i}`, i])));
    const mod = book(sheet("Big", Array.from({ length: 20 }, (_, i) => [`row-${i}`, i + 100])));
    const diff = packWorkbookDiff(diffWorkbooks(orig, mod, DEFAULT_OPTIONS));
    const report = captureWorkbookReport(diff, packWorkbook(orig), packWorkbook(mod), DEFAULT_OPTIONS, 5);
    expect(report.changes?.[0]?.length).toBe(5);
    expect(report.truncated?.[0]).toBe(20);
    expect(isValidWorkbookReport(report)).toBe(true);

    const encoded = await encodeWorkbookReport(report);
    const decoded = await decodeWorkbookReport(encoded);
    expect(decoded).toEqual(report);
  });

  test("aborts oversized gzip decompression streams incrementally before RAM blows up", async () => {
    const bigText = JSON.stringify({ data: "A".repeat(200_000) });
    const gzipBlob = await new Response(new Blob([bigText]).stream().pipeThrough(new CompressionStream("gzip"))).blob();
    expect(gzipBlob.size).toBeLessThan(2_000);
    await expect(decodeWorkbookReport({ encoding: "gzip", payload: gzipBlob }, 4_096)).rejects.toThrow(/safe size limit/i);
  });

  test("rejects malformed reports, __proto__ map keys, and truncated === 0", async () => {
    const badJson = new Blob(["{not-json"], { type: "application/json" });
    await expect(decodeWorkbookReport({ encoding: "json", payload: badJson })).rejects.toThrow(/unreadable/i);

    const badGzip = new Blob([new Uint8Array([1, 2, 3, 4])]);
    await expect(decodeWorkbookReport({ encoding: "gzip", payload: badGzip })).rejects.toThrow(/decompressed/i);

    const unsupportedEnc = { encoding: "br" as "json", payload: new Blob(["{}"]) };
    await expect(decodeWorkbookReport(unsupportedEnc)).rejects.toThrow(/unsupported encoding/i);

    const orig = book(sheet("S", [["a"]]));
    const mod = book(sheet("S", [["b"]]));
    const valid = captureWorkbookReport(packWorkbookDiff(diffWorkbooks(orig, mod, DEFAULT_OPTIONS)), packWorkbook(orig), packWorkbook(mod), DEFAULT_OPTIONS);

    const withProto = JSON.parse(JSON.stringify(valid));
    Object.defineProperty(withProto.changes, "__proto__", { value: [], enumerable: true });
    expect(isValidWorkbookReport(withProto)).toBe(false);

    const withZeroTrunc = { ...valid, truncated: { 0: 0 } };
    expect(isValidWorkbookReport(withZeroTrunc)).toBe(false);
  });
});

describe("storage, navigation, scrollSync, columns & state machines", () => {
  test("surfaces corrupted localStorage/IDB summaries safely and rejects invalid base64", () => {
    const textPrefix = `${SAVED_COMPARISON_PREFIX}text:`;
    const storage = memoryStorage({
      [`${textPrefix}broken-json`]: "{corrupt",
      [`${textPrefix}wrong-shape`]: JSON.stringify({ savedAt: Date.now(), snapshot: { mode: "text" } }),
      [`${textPrefix}valid`]: JSON.stringify({
        savedAt: 1700000000000,
        snapshot: {
          mode: "text",
          original: { name: "a.txt", text: "hi" },
          modified: { name: "b.txt", text: "bye" },
          options: DEFAULT_TEXT_OPTIONS,
          onlyChanges: false,
        },
      }),
    });
    const list = listLegacyComparisons(storage, "text");
    expect(list.length).toBe(3);
    expect(list.filter((e) => e.savedAt === 0).length).toBe(2);
    expect(() => readLegacyComparison(storage, "text", `${textPrefix}broken-json`)).toThrow(/unreadable/i);
    expect(() => readLegacyComparison(storage, "sheet", `${textPrefix}valid`)).toThrow(/no longer available/i);
    expect(() => decodeWorkbook({ name: "bad.xlsx", base64: "%%%not-base64%%%" })).toThrow(/unreadable/i);

    expect(sanitizeSummary(null)).toBeNull();
    expect(sanitizeSummary({ key: "wrong-prefix" })).toBeNull();
    expect(sanitizeSummary({ key: `${WORKBOOK_KEY_PREFIX}1`, savedAt: "bad" })).toEqual({
      key: `${WORKBOOK_KEY_PREFIX}1`,
      savedAt: 0,
      originalName: "Unreadable comparison",
      modifiedName: "",
    });
  });

  test("lowerBound, upperBound, syncScroll deadband, and column bounds behave accurately", () => {
    const arr = Int32Array.from([2, 5, 8, 12]);
    expect(lowerBound(arr, 5)).toBe(1);
    expect(upperBound(arr, 5)).toBe(2);
    expect(lowerBound(arr, 6)).toBe(2);
    expect(upperBound(arr, 12)).toBe(4);

    const a = { scrollTop: 100.2, scrollLeft: 50 } as HTMLElement;
    const b = { scrollTop: 100, scrollLeft: 10 } as HTMLElement;
    syncScroll({ current: a }, { current: b })();
    expect(b.scrollTop).toBe(100); // within 0.5px subpixel deadband
    expect(b.scrollLeft).toBe(50);

    expect(parseColumnName("XFD")).toBe(MAX_COLUMN_INDEX);
    expect(parseColumnName("XFE")).toBeNull();
    expect(columnName(MAX_COLUMN_INDEX)).toBe("XFD");
    expect(() => columnName(-1)).toThrow(RangeError);
    expect(() => columnName(Infinity)).toThrow(RangeError);
    expect(() => columnName(MAX_COLUMN_INDEX + 1)).toThrow(RangeError);
    expect(() => cellAddress(-1, 0)).toThrow(RangeError);
  });

  test("state machines preserve previous diff across re-diff, handle WORKER_CRASHED, and invalidate stale text diffs", () => {
    const wb = { fileName: "x.xlsx", sheets: [] } as PackedWorkbook;
    const diff = { sheets: [], identical: true } as unknown as PackedWorkbookDiff;
    let s = [
      { type: "FILE_SELECTED" as const, side: "original" as const, fileName: "a.xlsx", requestId: 1 },
      { type: "FILE_SELECTED" as const, side: "modified" as const, fileName: "b.xlsx", requestId: 2 },
      { type: "PARSE_SUCCEEDED" as const, side: "original" as const, requestId: 1, workbook: wb, parseMs: 1 },
      { type: "PARSE_SUCCEEDED" as const, side: "modified" as const, requestId: 2, workbook: wb, parseMs: 1 },
      { type: "DIFF_STARTED" as const, requestId: 3 },
      { type: "DIFF_SUCCEEDED" as const, requestId: 3, diff, diffMs: 4 },
      { type: "DIFF_STARTED" as const, requestId: 4 },
    ].reduce(reducer, INITIAL_STATE);
    expect(s.comparison).toEqual({ status: "running", requestId: 4, previous: { diff, diffMs: 4 } });
    s = reducer(s, { type: "WORKER_CRASHED", error: "OOM" });
    expect(s.comparison).toEqual({ status: "failed", error: "OOM" });

    let t = [
      { type: "TEXT_EDITED" as const, side: "original" as const, text: "a" },
      { type: "TEXT_EDITED" as const, side: "modified" as const, text: "b" },
      { type: "DIFF_STARTED" as const, requestId: 1 },
      { type: "TEXT_EDITED" as const, side: "original" as const, text: "ac" },
    ].reduce(textReducer, INITIAL_TEXT_STATE);
    // In-flight request 1 must be rejected after TEXT_EDITED invalidated it.
    expect(transitionText(t, { type: "DIFF_SUCCEEDED", requestId: 1, diff: {} as never, diffMs: 1 })).toBeNull();
    t = textReducer(t, { type: "RESTORED", original: { name: "a.txt", text: "" }, modified: { name: "b.txt", text: "x" } });
    expect(t.original.status).toBe("empty");
    expect(transition(INITIAL_STATE, { type: "FILE_REJECTED", side: "original", fileName: "bad.txt", error: "bad" })?.original.status).toBe("failed");
  });
});

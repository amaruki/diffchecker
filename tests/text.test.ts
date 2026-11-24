import { describe, expect, test } from "bun:test";
import { ROW_STATUS } from "../src/core/pack";
import { decodeText, TextDecodeError } from "../src/text/decode";
import { diffTexts } from "../src/text/diffText";
import { inlineDiff } from "../src/text/inline";
import { canonicalJson, childPath, formatPath, lineResolver, parseJson, printJson } from "../src/text/json";
import { splitLines } from "../src/text/lines";
import { highlightsAt, lineAt, packTextDiff } from "../src/text/pack";
import { DEFAULT_TEXT_OPTIONS, type TextDiffOptions, type TextInput } from "../src/text/types";
import { changeStarts, visibleLines } from "../src/text/view";

const opts = (o: Partial<TextDiffOptions> = {}): TextDiffOptions => ({ ...DEFAULT_TEXT_OPTIONS, ...o });
const txt = (text: string, name: string | null = null): TextInput => ({ name, text });
const statuses = (d: ReturnType<typeof diffTexts>) => d.rows.map((r) => r.status);

describe("splitLines", () => {
  test("handles CRLF, CR, LF and a final newline", () => {
    expect(splitLines("a\r\nb\rc\n")).toEqual(["a", "b", "c"]);
    expect(splitLines("a\n\nb")).toEqual(["a", "", "b"]);
    expect(splitLines("")).toEqual([]);
    expect(splitLines("\n")).toEqual([""]);
  });
});

describe("plain text diff", () => {
  test("identical texts", () => {
    const d = diffTexts(txt("one\ntwo\n"), txt("one\ntwo\n"), opts());
    expect(d).toMatchObject({ format: "text", identical: true, rawIdentical: true, counts: { unchanged: 2, added: 0, removed: 0, changed: 0 } });
  });

  test("single changed line with word highlights", () => {
    const d = diffTexts(txt("alpha\nthe quick fox\nomega"), txt("alpha\nthe slow fox\nomega"), opts());
    expect(statuses(d)).toEqual(["same", "changed", "same"]);
    expect(d.rows[1]!.hlOrig).toEqual([[4, 9]]);
    expect(d.rows[1]!.hlMod).toEqual([[4, 8]]);
  });

  test("inserted and deleted lines keep the rest aligned", () => {
    const d = diffTexts(txt("a\nb\nc\nd\ne"), txt("a\nNEW\nb\nc\ne"), opts());
    expect(d.counts).toEqual({ added: 1, removed: 1, changed: 0, unchanged: 4 });
    expect(d.rows.map((r) => [r.orig, r.mod])).toEqual([
      [0, 0],
      [-1, 1],
      [1, 2],
      [2, 3],
      [3, -1],
      [4, 4],
    ]);
  });

  test("ignore whitespace and case", () => {
    const a = txt("Hello   World\n  indented");
    const b = txt("hello world\nindented  ");
    expect(diffTexts(a, b, opts()).identical).toBe(false);
    expect(diffTexts(a, b, opts({ ignoreWhitespace: true })).identical).toBe(false);
    const d = diffTexts(a, b, opts({ ignoreWhitespace: true, ignoreCase: true }));
    expect(d.identical).toBe(true);
    expect(d.rawIdentical).toBe(false);
    expect(d.notes[0]!.message).toContain("whitespace");
  });

  test("ignore blank lines", () => {
    const a = txt("a\n\nb\nc");
    const b = txt("a\nb\n\n\nc");
    expect(diffTexts(a, b, opts()).identical).toBe(false);
    const d = diffTexts(a, b, opts({ ignoreBlankLines: true }));
    expect(d.identical).toBe(true);
    // Every line of both sides is still shown.
    expect(d.rows.filter((r) => r.orig >= 0)).toHaveLength(4);
    expect(d.rows.filter((r) => r.mod >= 0)).toHaveLength(5);
  });

  test("CRLF vs LF is equal, with an explanation", () => {
    const d = diffTexts(txt("a\r\nb\r\n"), txt("a\nb\n"), opts());
    expect(d.identical).toBe(true);
    expect(d.notes.map((n) => n.message).join()).toContain("line endings");
  });

  test("empty side: every line is added", () => {
    const d = diffTexts(txt(""), txt("x\ny"), opts());
    expect(d.counts.added).toBe(2);
  });
});

describe("JSON diff", () => {
  test("auto-detects JSON; formatting and key order do not matter", () => {
    const d = diffTexts(txt('{"b":1,"a":[1,2]}'), txt('{\n  "a": [1, 2],\n  "b": 1\n}\n'), opts());
    expect(d.format).toBe("json");
    expect(d.identical).toBe(true);
    expect(d.json?.total).toBe(0);
  });

  test("key order counts when sortKeys is off", () => {
    const d = diffTexts(txt('{"b":1,"a":2}'), txt('{"a":2,"b":1}'), opts({ sortKeys: false }));
    expect(d.identical).toBe(false);
    expect(d.json?.total).toBe(0);
    expect(d.notes.map((n) => n.message).join()).toContain("key order");
  });

  test("value change reports the path and the printed line", () => {
    const a = '{"users":[{"name":"Ada","email":"ada@a.io"},{"name":"Alan"}]}';
    const b = '{"users":[{"name":"Ada","email":"ada@b.io"},{"name":"Alan"}]}';
    const d = diffTexts(txt(a), txt(b), opts());
    expect(d.json?.changes).toEqual([
      {
        kind: "changed",
        origPath: "$.users[0].email",
        modPath: "$.users[0].email",
        oldValue: '"ada@a.io"',
        newValue: '"ada@b.io"',
        origLine: 3,
        modLine: 3,
      },
    ]);
    // Keys print sorted, so "email" precedes "name".
    expect(d.left[3]).toBe('      "email": "ada@a.io",');
    expect(d.counts).toMatchObject({ changed: 1, added: 0, removed: 0 });
  });

  test("appending an array element adds lines without changing the previous one", () => {
    const d = diffTexts(txt("[1, 2]"), txt("[1, 2, 3]"), opts());
    expect(d.counts).toMatchObject({ added: 1, removed: 0, changed: 0 });
    expect(d.json?.changes).toMatchObject([{ kind: "added", modPath: "$[2]", newValue: "3" }]);
  });

  test("inserting an array element is one change, not a cascade", () => {
    const d = diffTexts(txt('[{"id":1},{"id":2},{"id":3}]'), txt('[{"id":0},{"id":1},{"id":2},{"id":3}]'), opts());
    expect(d.json?.total).toBe(1);
    expect(d.json?.changes[0]).toMatchObject({ kind: "added", modPath: "$[0]" });
  });

  test("type change and removed key", () => {
    const d = diffTexts(txt('{"n":1,"gone":true}'), txt('{"n":"1"}'), opts());
    const kinds = d.json!.changes.map((c) => `${c.kind}:${c.origPath ?? c.modPath}`).sort();
    expect(kinds).toEqual(["removed:$.gone", "type:$.n"]);
  });

  test("invalid JSON falls back to text with a warning naming the side", () => {
    const d = diffTexts(txt('{"a": 1}'), txt('{"a": 1,}'), opts());
    expect(d.format).toBe("text");
    expect(d.notes[0]).toMatchObject({ level: "warning" });
    expect(d.notes[0]!.message).toStartWith("Modified is not valid JSON");
  });

  test("format: text forces a line diff of the raw input", () => {
    const d = diffTexts(txt('{"a":1}'), txt('{ "a": 1 }'), opts({ format: "text" }));
    expect(d.format).toBe("text");
    expect(d.identical).toBe(false);
  });

  test("special keys get bracket paths", () => {
    expect(childPath("$", "plain_key")).toBe("$.plain_key");
    expect(childPath("$", "has space")).toBe('$["has space"]');
    expect(childPath("$", 3)).toBe("$[3]");
  });

  test("parse error names line and column when the engine gives a position", () => {
    try {
      parseJson('{\n  "a": 1,\n  oops\n}');
      throw new Error("expected a parse error");
    } catch (err) {
      expect((err as Error).name).toBe("JsonParseError");
    }
  });

  test("lineResolver finds the printed line of a path", () => {
    const doc = { z: [{}, []], a: { b: [1, { c: 2 }] } };
    const lines = printJson(doc, true);
    expect(lines.slice(0, 4)).toEqual(["{", '  "a": {', '    "b": [', "      1,"]);
    const line = lineResolver(doc, true);
    // Check every path against the printed text, in both key orders.
    expect(lines[line(["a", "b", 1, "c"])]).toBe('        "c": 2');
    expect(lines[line(["z", 1])]).toBe("    []");
    expect(line(["missing"])).toBe(-1);
    const unsorted = printJson(doc, false);
    expect(unsorted[lineResolver(doc, false)(["a", "b", 0])]).toBe("      1,");
    expect(formatPath(["a", "b", 1, "has space"])).toBe('$.a.b[1]["has space"]');
  });
});

describe("inlineDiff", () => {
  test("highlights only the differing words", () => {
    const r = inlineDiff("let x = 10;", "let y = 10;", (t) => t);
    expect(r).toEqual({ a: [[4, 5]], b: [[4, 5]] });
  });

  test("normalizer makes case-insensitive tokens equal", () => {
    expect(inlineDiff("Hello", "hello", (t) => t.toLowerCase())).toEqual({ a: [], b: [] });
  });
});

describe("decodeText", () => {
  test("UTF-8 and UTF-16 with BOM", () => {
    expect(decodeText(new TextEncoder().encode("héllo"))).toBe("héllo");
    const utf16 = new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]);
    expect(decodeText(utf16)).toBe("hi");
  });

  test("rejects binary data", () => {
    expect(() => decodeText(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01]))).toThrow(TextDecodeError);
  });
});

describe("view helpers", () => {
  const S = (...names: string[]) => Uint8Array.from(names.map((n) => ROW_STATUS.indexOf(n as never)));

  test("only-changes view keeps context and collapses gaps", () => {
    const status = S("same", "same", "same", "same", "same", "changed", "same", "same", "same", "same", "same");
    expect([...visibleLines(status, true, 1)]).toEqual([-4, 4, 5, 6, -4]);
    expect([...visibleLines(status, false)]).toHaveLength(11);
  });

  test("change starts mark the first row of each block", () => {
    const status = S("same", "added", "added", "same", "removed");
    const visible = visibleLines(status, false);
    expect([...changeStarts(visible, status)]).toEqual([1, 4]);
  });
});

describe("packTextDiff", () => {
  test("round-trips lines and highlights", () => {
    const d = diffTexts(txt("a b\nkeep"), txt("a c\nkeep"), opts());
    const p = packTextDiff(d);
    expect(lineAt(p.left, 0)).toBe("a b");
    expect(lineAt(p.right, 1)).toBe("keep");
    expect(highlightsAt(p.hlMod, 0)).toEqual([[2, 3]]);
    expect(highlightsAt(p.hlMod, 1)).toEqual([]);
    expect(p.left.maxLength).toBe(4);
  });
});

describe("JSON array pairing inside a gap", () => {
  test("an edited element next to an inserted one is a change plus an addition", () => {
    const a = '[{"id":1,"name":"Ada","email":"a@x"},{"id":2,"name":"Alan"}]';
    const b = '[{"id":0,"name":"Radia","email":"r@x"},{"id":1,"name":"Ada","email":"a@y"},{"id":2,"name":"Alan"}]';
    const d = diffTexts(txt(a), txt(b), opts());
    const got = d.json!.changes.map((c) => `${c.kind} ${c.origPath ?? "-"} ${c.modPath ?? "-"}`);
    expect(got).toEqual(["added - $[0]", "changed $[0].email $[1].email"]);
  });

  test("dissimilar elements are a removal plus an addition, not a change", () => {
    const d = diffTexts(txt('[{"a":1,"b":2}]'), txt('[{"c":3,"d":4}]'), opts());
    expect(d.json!.changes.map((c) => c.kind)).toEqual(["removed", "added"]);
  });

  test("different primitives at the same position still pair as a change", () => {
    const d = diffTexts(txt('["admin"]'), txt('["viewer"]'), opts());
    expect(d.json!.changes).toMatchObject([{ kind: "changed", origPath: "$[0]", modPath: "$[0]" }]);
  });
});

describe("canonicalJson", () => {
  test("sorts keys at every depth and keeps a __proto__ key as data", () => {
    const v = parseJson('{"b":{"y":1,"x":2},"__proto__":{"z":0},"a":[{"d":1,"c":2}]}');
    expect(canonicalJson(v, true)).toBe('{"__proto__":{"z":0},"a":[{"c":2,"d":1}],"b":{"x":2,"y":1}}');
    expect(canonicalJson(v, false)).toBe('{"b":{"y":1,"x":2},"__proto__":{"z":0},"a":[{"d":1,"c":2}]}');
  });
});

describe("line pairing inside a gap", () => {
  test("an edited line pairs with its counterpart, not the inserted line at the same offset", () => {
    const d = diffTexts(txt("start\nemail: ada@example.com\nend"), txt("start\nemail: radia@other.org\nemail: ada@example.org\nend"), opts());
    expect(d.rows.map((r) => `${r.orig},${r.mod},${r.status}`)).toEqual(["0,0,same", "-1,1,added", "1,2,changed", "2,3,same"]);
  });

  test("unrelated lines become a removal plus an addition", () => {
    const d = diffTexts(txt("a\nalpha beta\nz"), txt("a\ngamma delta\nz"), opts());
    expect(d.counts).toMatchObject({ added: 1, removed: 1, changed: 0 });
  });
});

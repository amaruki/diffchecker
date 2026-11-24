import { describe, expect, test } from "bun:test";
import { diffSheetContents } from "../src/core/diffSheet";
import { diffWorkbooks } from "../src/core/diffWorkbook";
import { DEFAULT_OPTIONS, type AlignedRow, type DiffOptions } from "../src/core/types";
import { book, clone, date, fx, PEOPLE, sheet, type Literal } from "./helpers";

const opts = (o: Partial<DiffOptions> = {}): DiffOptions => ({ ...DEFAULT_OPTIONS, ...o });
const nonSame = (s: { rows: AlignedRow[] }) => s.rows.filter((r) => r.status !== "same");

describe("identical workbooks", () => {
  test("report no differences and every sheet matched", () => {
    const a = book(sheet("People", PEOPLE), sheet("Empty", []));
    const d = diffWorkbooks(a, clone(a), opts());
    expect(d.identical).toBe(true);
    expect(d.sheetOrderChanged).toBe(false);
    expect(d.sheets.map((s) => [s.status, s.identical])).toEqual([
      ["matched", true],
      ["matched", true],
    ]);
    expect(d.totals.changedCells + d.totals.addedRows + d.totals.removedRows).toBe(0);
    expect(d.sheets[0]!.rows).toHaveLength(PEOPLE.length);
  });

  test("different sheet order is reported but still identical", () => {
    const a = book(sheet("A", [[1]]), sheet("B", [[2]]));
    const b = book(sheet("B", [[2]]), sheet("A", [[1]]));
    const d = diffWorkbooks(a, b, opts());
    expect(d.identical).toBe(true);
    expect(d.sheetOrderChanged).toBe(true);
    expect(d.sheets.map((s) => s.modName)).toEqual(["B", "A"]);
  });
});

describe("cell changes", () => {
  test("single changed cell", () => {
    const a = sheet("S", PEOPLE);
    const b = clone(a);
    b.rows[2]![2] = { type: "s", value: "Arlington", text: "Arlington" };
    const d = diffSheetContents(a, b, opts());
    expect(d.counts).toMatchObject({ changedRows: 1, changedCells: 1, addedRows: 0, removedRows: 0, addedCells: 0, removedCells: 0 });
    expect(nonSame(d)).toEqual([
      { orig: 2, mod: 2, status: "changed", cells: [{ col: 2, status: "changed", kind: "value" }] },
    ]);
  });

  test("cell added and cell removed inside a row", () => {
    const a = sheet("S", [["a", "b", null]]);
    const b = sheet("S", [["a", null, "c"]]);
    const d = diffSheetContents(a, b, opts());
    expect(d.rows[0]!.cells).toEqual([
      { col: 1, status: "removed" },
      { col: 2, status: "added" },
    ]);
    expect(d.counts).toMatchObject({ changedRows: 1, addedCells: 1, removedCells: 1, changedCells: 0 });
  });

  test("number vs text with the same digits is a change", () => {
    const d = diffSheetContents(sheet("S", [[5]]), sheet("S", [["5"]]), opts());
    expect(d.counts.changedCells).toBe(1);
  });

  test("float noise below 15 significant digits is ignored", () => {
    const d = diffSheetContents(sheet("S", [[0.1 + 0.2]]), sheet("S", [[0.3]]), opts());
    expect(d.counts.changedCells).toBe(0);
  });

  test("number formatting does not count as a change", () => {
    const a = sheet("S", [[{ type: "n", value: 1234.5, text: "1234.5" }]]);
    const b = sheet("S", [[{ type: "n", value: 1234.5, text: "$1,234.50" }]]);
    expect(diffSheetContents(a, b, opts()).counts.changedCells).toBe(0);
  });

  test("dates compare by value, not by display format", () => {
    const a = sheet("S", [[date("2024-03-01T00:00:00.000Z", "3/1/24")]]);
    const same = sheet("S", [[date("2024-03-01T00:00:00.000Z", "2024-03-01")]]);
    const later = sheet("S", [[date("2024-03-02T00:00:00.000Z", "3/2/24")]]);
    expect(diffSheetContents(a, same, opts()).counts.changedCells).toBe(0);
    expect(diffSheetContents(a, later, opts()).counts.changedCells).toBe(1);
  });
});

describe("added and removed rows", () => {
  test("rows appended at the end", () => {
    const a = sheet("S", PEOPLE);
    const b = sheet("S", [...PEOPLE, [5, "Barbara", "Boston"], [6, "Ken", "Berkeley"]]);
    const d = diffSheetContents(a, b, opts());
    expect(d.counts).toMatchObject({ addedRows: 2, addedCells: 6, changedRows: 0, removedRows: 0 });
    expect(d.rows.slice(-2).map((r) => [r.orig, r.mod, r.status])).toEqual([
      [-1, 5, "added"],
      [-1, 6, "added"],
    ]);
  });

  test("row inserted in the middle shifts nothing else (aligned mode)", () => {
    const rows = [...PEOPLE];
    rows.splice(2, 0, [99, "Radia", "Seattle"]);
    const d = diffSheetContents(sheet("S", PEOPLE), sheet("S", rows), opts());
    expect(d.counts).toMatchObject({ addedRows: 1, changedRows: 0, removedRows: 0 });
    expect(nonSame(d).map((r) => [r.orig, r.mod, r.status])).toEqual([[-1, 2, "added"]]);
  });

  test("row removed from the middle", () => {
    const rows = PEOPLE.filter((_, i) => i !== 2);
    const d = diffSheetContents(sheet("S", PEOPLE), sheet("S", rows), opts());
    expect(d.counts).toMatchObject({ removedRows: 1, removedCells: 3, changedRows: 0, addedRows: 0 });
    expect(nonSame(d).map((r) => [r.orig, r.mod, r.status])).toEqual([[2, -1, "removed"]]);
  });

  test("insert + delete + edit together", () => {
    const rows: Literal[][] = PEOPLE.map((r) => [...r]);
    rows[1]![1] = "Augusta Ada";
    rows.splice(3, 1);
    rows.push([5, "Barbara", "Boston"]);
    const d = diffSheetContents(sheet("S", PEOPLE), sheet("S", rows), opts());
    expect(d.counts).toMatchObject({ addedRows: 1, removedRows: 1, changedRows: 1, changedCells: 1 });
  });

  test("strict index mode compares row N with row N", () => {
    const rows = [...PEOPLE];
    rows.splice(1, 0, [0, "Inserted", "Nowhere"]);
    const d = diffSheetContents(sheet("S", PEOPLE), sheet("S", rows), opts({ rowMatching: "index" }));
    expect(d.counts).toMatchObject({ changedRows: 4, addedRows: 1, removedRows: 0 });
  });

  test("duplicate rows align correctly", () => {
    const a = sheet("S", [["x"], ["x"], ["y"], ["x"]]);
    const b = sheet("S", [["x"], ["y"], ["x"], ["x"]]);
    const d = diffSheetContents(a, b, opts());
    expect(d.counts.addedRows + d.counts.removedRows).toBe(2);
    expect(d.counts.changedRows).toBe(0);
  });
});

describe("key column matching", () => {
  test("reordered rows with the same keys are identical", () => {
    const [header, ...body] = PEOPLE;
    const b = sheet("S", [header!, ...[...body].reverse()]);
    const d = diffSheetContents(sheet("S", PEOPLE), b, opts({ rowMatching: "key", keyColumn: 0 }));
    expect(d.counts).toMatchObject({ addedRows: 0, removedRows: 0, changedRows: 0 });
  });

  test("changed, added and removed keys", () => {
    const b = sheet("S", [
      ["ID", "Name", "City"],
      [3, "Alan", "Manchester"],
      [1, "Ada", "London"],
      [7, "Linus", "Helsinki"],
      [4, "Edsger", "Austin"],
    ]);
    const d = diffSheetContents(sheet("S", PEOPLE), b, opts({ rowMatching: "key", keyColumn: 0 }));
    expect(d.counts).toMatchObject({ changedRows: 1, changedCells: 1, addedRows: 1, removedRows: 1 });
    const changed = d.rows.find((r) => r.status === "changed")!;
    expect([changed.orig, changed.mod]).toEqual([3, 1]);
    expect(d.rows.find((r) => r.status === "removed")!.orig).toBe(2);
  });

  test("duplicate keys pair by occurrence", () => {
    const a = sheet("S", [["k", 1], ["k", 2]]);
    const b = sheet("S", [["k", 1], ["k", 3]]);
    const d = diffSheetContents(a, b, opts({ rowMatching: "key", keyColumn: 0 }));
    expect(d.counts).toMatchObject({ changedRows: 1, addedRows: 0, removedRows: 0 });
  });
});

describe("sheets", () => {
  test("added and removed sheets", () => {
    const a = book(sheet("Keep", PEOPLE), sheet("Old", [["gone"]]));
    const b = book(sheet("Keep", PEOPLE), sheet("New", [["fresh"], ["data"]]));
    const d = diffWorkbooks(a, b, opts());
    expect(d.identical).toBe(false);
    expect(d.totals).toMatchObject({ addedSheets: 1, removedSheets: 1, renamedSheets: 0, addedRows: 2, removedRows: 1 });
    const byStatus = Object.fromEntries(d.sheets.map((s) => [s.status, s.origName ?? s.modName]));
    expect(byStatus).toEqual({ matched: "Keep", removed: "Old", added: "New" });
  });

  test("renamed sheet is detected by content", () => {
    const a = book(sheet("Q1", PEOPLE));
    const rows = PEOPLE.map((r) => [...r]);
    rows[1]![2] = "Paris";
    const b = book(sheet("Quarter 1", rows));
    const d = diffWorkbooks(a, b, opts());
    expect(d.sheets).toHaveLength(1);
    expect(d.sheets[0]).toMatchObject({ status: "renamed", origName: "Q1", modName: "Quarter 1", identical: false });
    expect(d.sheets[0]!.counts.changedCells).toBe(1);
  });

  test("removed sheet is listed before the sheet that followed it", () => {
    const a = book(sheet("A", [[1]]), sheet("B", [[2]]), sheet("C", [[3]]));
    const b = book(sheet("A", [[1]]), sheet("C", [[3]]));
    expect(diffWorkbooks(a, b, opts()).sheets.map((s) => `${s.status}:${s.origName}`)).toEqual([
      "matched:A",
      "removed:B",
      "matched:C",
    ]);
  });

  test("empty sheets: both empty match; empty vs filled differs", () => {
    expect(diffSheetContents(sheet("E", []), sheet("E", []), opts()).rows).toHaveLength(0);
    const d = diffSheetContents(sheet("E", []), sheet("E", PEOPLE), opts());
    expect(d.counts.addedRows).toBe(PEOPLE.length);
  });

  test("merged range changes are counted", () => {
    const d = diffSheetContents(sheet("S", [["Title"]], ["A1:C1"]), sheet("S", [["Title"]], ["A1:D1"]), opts());
    expect(d.mergesAdded).toEqual(["A1:D1"]);
    expect(d.mergesRemoved).toEqual(["A1:C1"]);
    expect(d.counts.mergeChanges).toBe(2);
  });
});

describe("options", () => {
  test("ignore case", () => {
    const a = sheet("S", [["Hello"]]);
    const b = sheet("S", [["HELLO"]]);
    expect(diffSheetContents(a, b, opts()).counts.changedCells).toBe(1);
    expect(diffSheetContents(a, b, opts({ ignoreCase: true })).counts.changedCells).toBe(0);
  });

  test("trim whitespace", () => {
    const a = sheet("S", [["value"]]);
    const b = sheet("S", [["  value \t"]]);
    expect(diffSheetContents(a, b, opts()).counts.changedCells).toBe(1);
    expect(diffSheetContents(a, b, opts({ trimWhitespace: true })).counts.changedCells).toBe(0);
  });

  test("ignore empty cells: empty strings and blank rows", () => {
    const a = sheet("S", [["a", null], ["b", null]]);
    const b = sheet("S", [["a", ""], [], ["b", null]]);
    const strict = diffSheetContents(a, b, opts());
    expect(strict.counts.addedCells + strict.counts.addedRows).toBeGreaterThan(0);
    const relaxed = diffSheetContents(a, b, opts({ ignoreEmpty: true }));
    expect(relaxed.counts).toMatchObject({ addedRows: 0, removedRows: 0, changedRows: 0 });
  });

  test("whitespace-only cell is empty when trim and ignore-empty are both on", () => {
    const d = diffSheetContents(sheet("S", [["a"]]), sheet("S", [["a", "   "]]), opts({ ignoreEmpty: true, trimWhitespace: true }));
    expect(d.counts.changedRows).toBe(0);
  });

  test("formula change with the same value: only formula mode reports it", () => {
    const a = sheet("S", [[2, 3, fx("A1*B1", 6)]]);
    const b = sheet("S", [[2, 3, fx("B1*A1", 6)]]);
    expect(diffSheetContents(a, b, opts({ compareMode: "values" })).counts.changedCells).toBe(0);
    const d = diffSheetContents(a, b, opts({ compareMode: "formulas" }));
    expect(d.rows[0]!.cells).toEqual([{ col: 2, status: "changed", kind: "formula" }]);
  });

  test("value change caused upstream: only values mode reports it", () => {
    const a = sheet("S", [[2, fx("A1*10", 20)]]);
    const b = sheet("S", [[3, fx("A1*10", 30)]]);
    expect(diffSheetContents(a, b, opts({ compareMode: "values" })).counts.changedCells).toBe(2);
    expect(diffSheetContents(a, b, opts({ compareMode: "formulas" })).counts.changedCells).toBe(1);
  });

  test("formula and value both changed reports kind 'both'", () => {
    const a = sheet("S", [[fx("1+1", 2)]]);
    const b = sheet("S", [[fx("1+2", 3)]]);
    expect(diffSheetContents(a, b, opts()).rows[0]!.cells).toEqual([{ col: 0, status: "changed", kind: "both" }]);
  });
});

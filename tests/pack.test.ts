import { describe, expect, test } from "bun:test";
import { diffSheetContents } from "../src/core/diffSheet";
import { cellCodeAt, cellIndex, CellCode, packRows, packSheet, readCell, ROW_STATUS } from "../src/core/pack";
import { DEFAULT_OPTIONS } from "../src/core/types";
import { columnName, parseColumnName } from "../src/ui/columns";
import { fx, sheet } from "./helpers";

describe("packSheet", () => {
  test("round-trips sparse cells", () => {
    const s = sheet("S", [["a", null, 3], [], [null, fx("A1*2", 6)]]);
    const { grid } = packSheet(s);
    expect(grid.rowCount).toBe(3);
    expect(cellIndex(grid, 0, 1)).toBe(-1);
    expect(cellIndex(grid, 1, 0)).toBe(-1);
    expect(cellIndex(grid, 9, 0)).toBe(-1);
    expect(readCell(grid, cellIndex(grid, 0, 0))).toEqual({ type: "s", text: "a", raw: "a", formula: null });
    expect(readCell(grid, cellIndex(grid, 0, 2))).toEqual({ type: "n", text: "3", raw: "3", formula: null });
    expect(readCell(grid, cellIndex(grid, 2, 1))).toEqual({ type: "n", text: "6", raw: "6", formula: "A1*2" });
  });
});

describe("packRows", () => {
  test("encodes statuses and cell codes", () => {
    const d = diffSheetContents(sheet("S", [["a", fx("1+1", 2)], ["gone"]]), sheet("S", [["b", fx("1+2", 3)]]), DEFAULT_OPTIONS);
    const rows = packRows(d.rows);
    expect(rows.length).toBe(d.rows.length);
    expect(ROW_STATUS[rows.status[0]!]).toBe("changed");
    expect(cellCodeAt(rows, 0, 0)).toBe(CellCode.ChangedValue);
    expect(cellCodeAt(rows, 0, 1)).toBe(CellCode.ChangedBoth);
    expect(cellCodeAt(rows, 0, 5)).toBe(CellCode.None);
    expect(ROW_STATUS[rows.status[1]!]).toBe("removed");
    expect(cellCodeAt(rows, 1, 0)).toBe(CellCode.Removed);
  });
});

describe("column names", () => {
  test.each([
    [0, "A"],
    [25, "Z"],
    [26, "AA"],
    [701, "ZZ"],
    [702, "AAA"],
  ])("%i ↔ %s", (i, name) => {
    expect(columnName(i)).toBe(name);
    expect(parseColumnName(name.toLowerCase())).toBe(i);
  });

  test("rejects non-letters", () => {
    expect(parseColumnName("1")).toBeNull();
    expect(parseColumnName("")).toBeNull();
    expect(parseColumnName("ABCD")).toBeNull();
  });
});

import { describe, expect, test } from "bun:test";
import { utils, write } from "xlsx";
import { diffWorkbooks } from "../src/core/diffWorkbook";
import { parseWorkbook, WorkbookParseError } from "../src/core/parse";
import { DEFAULT_OPTIONS } from "../src/core/types";

function xlsxBuffer(sheets: Record<string, unknown[][]>, merges: Record<string, string[]> = {}): ArrayBuffer {
  const wb = utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    const ws = utils.aoa_to_sheet(aoa, { cellDates: true });
    if (merges[name]) ws["!merges"] = merges[name].map((r) => utils.decode_range(r));
    utils.book_append_sheet(wb, ws, name);
  }
  const u8 = write(wb, { type: "array", bookType: "xlsx", cellDates: true, compression: true }) as ArrayBuffer;
  return u8;
}

const bytes = (...b: number[]) => new Uint8Array(b).buffer;

describe("parseWorkbook", () => {
  test("reads values, formulas, dates, booleans and merges", () => {
    const buf = xlsxBuffer(
      {
        Data: [
          ["Name", "Qty", "Price", "Total", "When", "Ok"],
          ["Widget", 2, 3.5, { t: "n", v: 7, f: "B2*C2" }, new Date(Date.UTC(2024, 0, 15)), true],
        ],
        Empty: [],
      },
      { Data: ["A3:C3"] },
    );
    const wb = parseWorkbook(buf, "t.xlsx");
    expect(wb.sheets.map((s) => s.name)).toEqual(["Data", "Empty"]);
    const [header, row] = wb.sheets[0]!.rows;
    expect(header![0]).toMatchObject({ type: "s", value: "Name" });
    expect(row![1]).toMatchObject({ type: "n", value: 2 });
    expect(row![3]).toMatchObject({ type: "n", value: 7, formula: "B2*C2" });
    expect(row![4]!.type).toBe("d");
    expect(typeof row![4]!.value).toBe("string");
    expect(row![5]).toMatchObject({ type: "b", value: true });
    expect(wb.sheets[0]!.merges).toEqual(["A3:C3"]);
    expect(wb.sheets[0]!.colCount).toBe(6);
    expect(wb.sheets[1]!.rows).toEqual([]);
  });

  test("the same file parsed twice is identical", () => {
    const buf = xlsxBuffer({ S: [["a", 1], ["b", 2]] });
    const d = diffWorkbooks(parseWorkbook(buf, "a"), parseWorkbook(buf.slice(0), "b"), DEFAULT_OPTIONS);
    expect(d.identical).toBe(true);
  });

  test.each([
    ["empty file", new ArrayBuffer(0), /empty/],
    ["plain text / CSV", new TextEncoder().encode("a,b,c\n1,2,3\n").buffer as ArrayBuffer, /not an \.xlsx file/],
    ["legacy .xls or encrypted", bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0), /legacy \.xls|password/],
    ["truncated zip", bytes(0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6), /corrupted/],
  ])("rejects %s with a clear message", (_label, buf, pattern) => {
    expect(() => parseWorkbook(buf, "bad.xlsx")).toThrow(WorkbookParseError);
    expect(() => parseWorkbook(buf, "bad.xlsx")).toThrow(pattern);
  });

  test("rejects a valid xlsx cut in half", () => {
    const buf = xlsxBuffer({ S: [["a", 1]] });
    expect(() => parseWorkbook(buf.slice(0, Math.floor(buf.byteLength / 2)), "half.xlsx")).toThrow(WorkbookParseError);
  });

  test("bundled sample pair parses and differs", async () => {
    const load = async (p: string) => parseWorkbook(await Bun.file(p).arrayBuffer(), p);
    const a = await load("samples/original.xlsx");
    const b = await load("samples/modified.xlsx");
    const d = diffWorkbooks(a, b, DEFAULT_OPTIONS);
    expect(d.identical).toBe(false);
    expect(d.totals).toMatchObject({ addedSheets: 1, removedSheets: 1, renamedSheets: 1 });
    expect(d.sheetOrderChanged).toBe(true);
    expect(diffWorkbooks(a, a, DEFAULT_OPTIONS).identical).toBe(true);
  });
});

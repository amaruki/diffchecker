import { expect, test } from "bun:test";
import { diffWorkbooks } from "../src/core/diffWorkbook";
import { CellCode, packWorkbook, packWorkbookDiff } from "../src/core/pack";
import { DEFAULT_OPTIONS, type WorkbookData } from "../src/core/types";
import { captureWorkbookReport } from "../src/core/workbookReport";
import { decodeWorkbookReport, encodeWorkbookReport } from "../src/state/reportEncoding";
import { book, fx, sheet } from "./helpers";

function report(original: WorkbookData, modified: WorkbookData) {
  const options = { ...DEFAULT_OPTIONS, rowMatching: "index", compareMode: "formulas" } as const;
  return captureWorkbookReport(
    packWorkbookDiff(diffWorkbooks(original, modified, options)),
    packWorkbook(original),
    packWorkbook(modified),
    options,
  );
}

test("identical workbooks keep dimensions and order without recording unchanged cells", async () => {
  const alpha = sheet("Alpha", [["unchanged input text"]]);
  const beta = sheet("Beta", [[42]]);
  const result = report(book(alpha, beta), book(beta, alpha));
  expect(result).toMatchObject({
    identical: true,
    sheetOrderChanged: true,
    sheets: [{ modifiedName: "Beta", comparedRows: 1 }, { modifiedName: "Alpha", originalSize: [1, 1] }],
  });
  expect(result.changes).toBeUndefined();
  expect(JSON.stringify(result)).not.toContain("unchanged input text");
  const encoded = await encodeWorkbookReport(result);
  expect(encoded.payload.size).toBeLessThan(new Blob([JSON.stringify(result)]).size);
  expect(await decodeWorkbookReport(encoded)).toEqual(result);
});

test("reports preserve formula changes, empty added rows, and merges", () => {
  const result = report(
    book(sheet("Data", [[fx("1+1", 2), "", "unchanged input text"]], ["C1:D1"])),
    book(sheet("Data", [[fx("2", 2), 0, "unchanged input text"], []], ["E1:F1"])),
  );
  expect(result.identical).toBe(false);
  expect(result.sheets[0]).toMatchObject({ mergesAdded: ["E1:F1"], mergesRemoved: ["C1:D1"] });
  expect(result.changes?.[0]).toEqual([
    {
      originalRow: 0, modifiedRow: 0, status: "changed", column: 0, code: CellCode.ChangedFormula,
      original: { type: "n", text: "2", raw: "2", formula: "1+1" },
      modified: { type: "n", text: "2", raw: "2", formula: "2" },
    },
    {
      originalRow: 0, modifiedRow: 0, status: "changed", column: 1, code: CellCode.ChangedValue,
      original: { type: "s", text: "", raw: "", formula: null },
      modified: { type: "n", text: "0", raw: "0", formula: null },
    },
    { originalRow: -1, modifiedRow: 1, status: "added" },
  ]);
  expect(JSON.stringify(result)).not.toContain("unchanged input text");
});

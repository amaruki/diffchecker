import type { Cell, Row, SheetData, WorkbookData } from "../src/core/types";

export type Literal = string | number | boolean | null | Cell;

/** A formula cell with its cached value. */
export function fx(formula: string, value: number): Cell {
  return { type: "n", value, text: String(value), formula };
}

export function date(iso: string, text: string): Cell {
  return { type: "d", value: iso, text };
}

function toCell(v: Literal): Cell | undefined {
  if (v === null) return undefined;
  if (typeof v === "string") return { type: "s", value: v, text: v };
  if (typeof v === "number") return { type: "n", value: v, text: String(v) };
  if (typeof v === "boolean") return { type: "b", value: v, text: v ? "TRUE" : "FALSE" };
  return v;
}

/** Build a SheetData from an array of arrays; null leaves a hole. */
export function sheet(name: string, aoa: Literal[][], merges: string[] = []): SheetData {
  const rows: Row[] = aoa.map((r) => {
    const row: Row = [];
    r.forEach((v, c) => {
      const cell = toCell(v);
      if (cell) row[c] = cell;
    });
    return row;
  });
  return { name, rows, colCount: Math.max(0, ...rows.map((r) => r.length)), merges: [...merges].sort() };
}

export function book(...sheets: SheetData[]): WorkbookData {
  return { fileName: "test.xlsx", sheets };
}

/** Deep copy so a test can mutate the "modified" side freely. */
export function clone<T>(x: T): T {
  return structuredClone(x);
}

export const PEOPLE: Literal[][] = [
  ["ID", "Name", "City"],
  [1, "Ada", "London"],
  [2, "Grace", "New York"],
  [3, "Alan", "Wilmslow"],
  [4, "Edsger", "Austin"],
];

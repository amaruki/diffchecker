import type { PackedWorkbook, PackedWorkbookDiff } from "../core/pack";
import type { DiffOptions } from "../core/types";

export type Side = "original" | "modified";

/** Main thread → worker. `id` correlates the response; the main thread ignores stale ids. */
export type WorkerRequest =
  | { type: "load"; id: number; side: Side; fileName: string; buffer: ArrayBuffer }
  | { type: "clear"; side: Side }
  | { type: "diff"; id: number; options: DiffOptions }
  /** Exchange the two loaded workbooks. No response: the next diff request follows it in order. */
  | { type: "swap" };

/** Worker → main thread. */
export type WorkerResponse =
  | { type: "loaded"; id: number; side: Side; workbook: PackedWorkbook; parseMs: number }
  | { type: "load-error"; id: number; side: Side; message: string }
  | { type: "diffed"; id: number; diff: PackedWorkbookDiff; diffMs: number }
  | { type: "diff-error"; id: number; message: string };

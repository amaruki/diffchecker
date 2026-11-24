/// <reference lib="webworker" />
/**
 * Parses workbooks and computes diffs off the main thread.
 * Keeps the last parsed workbook per side so option changes re-run only the diff.
 */
import { diffWorkbooks } from "../core/diffWorkbook";
import { diffTransferables, packWorkbook, packWorkbookDiff, workbookTransferables } from "../core/pack";
import { parseWorkbook, WorkbookParseError } from "../core/parse";
import type { WorkbookData } from "../core/types";
import type { Side, WorkerRequest, WorkerResponse } from "./protocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const books: Partial<Record<Side, WorkbookData>> = {};

function reply(msg: WorkerResponse, transfer: Transferable[] = []): void {
  scope.postMessage(msg, transfer);
}

function messageOf(err: unknown): string {
  if (err instanceof WorkbookParseError) return err.message;
  return `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;
}

function handleLoad(req: Extract<WorkerRequest, { type: "load" }>): void {
  const started = performance.now();
  try {
    const wb = parseWorkbook(req.buffer, req.fileName);
    books[req.side] = wb;
    const packed = packWorkbook(wb);
    reply(
      { type: "loaded", id: req.id, side: req.side, workbook: packed, parseMs: performance.now() - started },
      workbookTransferables(packed),
    );
  } catch (err) {
    delete books[req.side];
    reply({ type: "load-error", id: req.id, side: req.side, message: messageOf(err) });
  }
}

function handleDiff(req: Extract<WorkerRequest, { type: "diff" }>): void {
  const started = performance.now();
  const { original, modified } = books;
  if (!original || !modified) {
    reply({ type: "diff-error", id: req.id, message: "Both files must be loaded before comparing." });
    return;
  }
  try {
    const diff = packWorkbookDiff(diffWorkbooks(original, modified, req.options));
    reply({ type: "diffed", id: req.id, diff, diffMs: performance.now() - started }, diffTransferables(diff));
  } catch (err) {
    reply({ type: "diff-error", id: req.id, message: messageOf(err) });
  }
}

function handleSwap(): void {
  const { original, modified } = books;
  books.original = modified;
  books.modified = original;
  if (!books.original) delete books.original;
  if (!books.modified) delete books.modified;
}

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  switch (req.type) {
    case "load":
      handleLoad(req);
      break;
    case "clear":
      delete books[req.side];
      break;
    case "diff":
      handleDiff(req);
      break;
    case "swap":
      handleSwap();
      break;
  }
};

/// <reference lib="webworker" />
/**
 * Text / JSON diff off the main thread. Kept apart from diff.worker.ts so it
 * does not load SheetJS.
 */
import { diffTexts } from "../text/diffText";
import { packTextDiff, textDiffTransferables } from "../text/pack";
import type { TextWorkerRequest, TextWorkerResponse } from "./textProtocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;

function reply(msg: TextWorkerResponse, transfer: Transferable[] = []): void {
  scope.postMessage(msg, transfer);
}

scope.onmessage = (event: MessageEvent<TextWorkerRequest>) => {
  const req = event.data;
  const started = performance.now();
  try {
    const diff = packTextDiff(diffTexts(req.original, req.modified, req.options));
    reply({ type: "diffed", id: req.id, diff, diffMs: performance.now() - started }, textDiffTransferables(diff));
  } catch (err) {
    reply({ type: "diff-error", id: req.id, message: `Unexpected error: ${err instanceof Error ? err.message : String(err)}` });
  }
};

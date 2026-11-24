import type { TextDiffOptions, TextInput } from "../text/types";
import type { TextWorkerRequest, TextWorkerResponse } from "./textProtocol";

/** Main-thread handle to the text worker. Same contract as DiffWorkerClient: ids in, every response out. */
export class TextWorkerClient {
  private readonly worker: Worker;
  private nextId = 1;

  constructor(onResponse: (msg: TextWorkerResponse) => void, onCrash: (message: string) => void) {
    this.worker = new Worker(new URL("./text.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<TextWorkerResponse>) => onResponse(e.data);
    this.worker.onerror = (e: ErrorEvent) => onCrash(e.message || "The text diff worker stopped unexpectedly.");
    this.worker.onmessageerror = () => onCrash("The text diff worker sent an unreadable message.");
  }

  diff(original: TextInput, modified: TextInput, options: TextDiffOptions): number {
    const id = this.nextId++;
    const msg: TextWorkerRequest = { type: "diff", id, original, modified, options };
    this.worker.postMessage(msg);
    return id;
  }

  terminate(): void {
    this.worker.terminate();
  }
}

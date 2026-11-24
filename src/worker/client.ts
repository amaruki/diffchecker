import type { DiffOptions } from "../core/types";
import type { Side, WorkerRequest, WorkerResponse } from "./protocol";

/**
 * Main-thread handle to the diff worker. Assigns request ids and forwards every
 * response to one listener; the state machine decides which ids are current.
 */
export class DiffWorkerClient {
  private readonly worker: Worker;
  private nextId = 1;

  constructor(onResponse: (msg: WorkerResponse) => void, onCrash: (message: string) => void) {
    this.worker = new Worker(new URL("./diff.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => onResponse(e.data);
    this.worker.onerror = (e: ErrorEvent) => onCrash(e.message || "The diff worker stopped unexpectedly.");
    this.worker.onmessageerror = () => onCrash("The diff worker sent an unreadable message.");
  }

  /** Transfers `buffer` to the worker; the caller must not use it afterwards. */
  load(side: Side, fileName: string, buffer: ArrayBuffer): number {
    const id = this.nextId++;
    this.post({ type: "load", id, side, fileName, buffer }, [buffer]);
    return id;
  }

  /** Release the worker's retained WorkbookData for `side`. */
  clear(side: Side): void {
    this.post({ type: "clear", side });
  }

  diff(options: DiffOptions): number {
    const id = this.nextId++;
    this.post({ type: "diff", id, options });
    return id;
  }

  /** Call only when the state machine accepted SWAPPED, so both sides stay in step. */
  swap(): void {
    this.post({ type: "swap" });
  }

  terminate(): void {
    this.worker.terminate();
  }

  private post(msg: WorkerRequest, transfer: Transferable[] = []): void {
    this.worker.postMessage(msg, transfer);
  }
}

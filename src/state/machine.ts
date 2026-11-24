/**
 * Application state machine. See README "State machine" for the transition tables.
 *
 * File slot:  empty | parsing | ready | failed
 * Comparison: idle | running | done | failed
 * No terminal states: the app cycles until the page closes.
 *
 * `transition` returns null for any event that no rule allows (including stale
 * worker responses whose request id no longer matches); the reducer then keeps
 * the current state.
 */
import type { PackedWorkbook, PackedWorkbookDiff } from "../core/pack";
import type { Side } from "../worker/protocol";

export type SlotState =
  | { status: "empty" }
  | { status: "parsing"; fileName: string; requestId: number; source?: File }
  | { status: "ready"; fileName: string; workbook: PackedWorkbook; parseMs: number; source?: File }
  | { status: "failed"; fileName: string; error: string };

export type ComparisonState =
  | { status: "idle" }
  /** `previous` keeps the current diff mounted across option changes so sheet tabs & scroll persist. */
  | { status: "running"; requestId: number; previous: { diff: PackedWorkbookDiff; diffMs: number } | null }
  | { status: "done"; diff: PackedWorkbookDiff; diffMs: number }
  | { status: "failed"; error: string };

export interface AppState {
  original: SlotState;
  modified: SlotState;
  comparison: ComparisonState;
}

export type AppEvent =
  | { type: "FILE_SELECTED"; side: Side; fileName: string; requestId: number; source?: File }
  | { type: "FILE_REJECTED"; side: Side; fileName: string; error: string }
  | { type: "PARSE_SUCCEEDED"; side: Side; requestId: number; workbook: PackedWorkbook; parseMs: number }
  | { type: "PARSE_FAILED"; side: Side; requestId: number; error: string }
  | { type: "FILE_CLEARED"; side: Side }
  | { type: "SWAPPED" }
  | { type: "DIFF_STARTED"; requestId: number }
  | { type: "DIFF_SUCCEEDED"; requestId: number; diff: PackedWorkbookDiff; diffMs: number }
  | { type: "DIFF_FAILED"; requestId: number; error: string }
  | { type: "WORKER_CRASHED"; error: string };

export const INITIAL_STATE: AppState = {
  original: { status: "empty" },
  modified: { status: "empty" },
  comparison: { status: "idle" },
};

const IDLE: ComparisonState = { status: "idle" };

/** A slot changed, so any comparison result is out of date. */
function withSlot(state: AppState, side: Side, slot: SlotState): AppState {
  return { ...state, [side]: slot, comparison: IDLE };
}

/** Guard for SWAPPED: no file is mid-parse (the worker would swap a half-loaded side), and there is something to swap. */
export function canSwap(state: Pick<AppState, "original" | "modified">): boolean {
  const slots = [state.original, state.modified];
  return slots.every((s) => s.status !== "parsing") && slots.some((s) => s.status !== "empty");
}

export function transition(state: AppState, event: AppEvent): AppState | null {
  switch (event.type) {
    case "FILE_SELECTED":
      return withSlot(state, event.side, {
        status: "parsing",
        fileName: event.fileName,
        requestId: event.requestId,
        source: event.source,
      });

    case "FILE_REJECTED":
      return withSlot(state, event.side, { status: "failed", fileName: event.fileName, error: event.error });

    case "PARSE_SUCCEEDED":
    case "PARSE_FAILED": {
      const slot = state[event.side];
      if (slot.status !== "parsing" || slot.requestId !== event.requestId) return null;
      return event.type === "PARSE_SUCCEEDED"
        ? withSlot(state, event.side, {
            status: "ready",
            fileName: slot.fileName,
            workbook: event.workbook,
            parseMs: event.parseMs,
            source: slot.source,
          })
        : withSlot(state, event.side, { status: "failed", fileName: slot.fileName, error: event.error });
    }

    case "FILE_CLEARED":
      if (state[event.side].status === "empty") return null;
      return withSlot(state, event.side, { status: "empty" });

    case "SWAPPED":
      if (!canSwap(state)) return null;
      return { original: state.modified, modified: state.original, comparison: IDLE };

    case "DIFF_STARTED": {
      if (state.original.status !== "ready" || state.modified.status !== "ready") return null;
      const cmp = state.comparison;
      const previous = cmp.status === "done" ? { diff: cmp.diff, diffMs: cmp.diffMs } : cmp.status === "running" ? cmp.previous : null;
      return { ...state, comparison: { status: "running", requestId: event.requestId, previous } };
    }

    case "DIFF_SUCCEEDED":
    case "DIFF_FAILED": {
      const cmp = state.comparison;
      if (cmp.status !== "running" || cmp.requestId !== event.requestId) return null;
      return {
        ...state,
        comparison:
          event.type === "DIFF_SUCCEEDED"
            ? { status: "done", diff: event.diff, diffMs: event.diffMs }
            : { status: "failed", error: event.error },
      };
    }

    case "WORKER_CRASHED": {
      const failParsing = (slot: SlotState): SlotState =>
        slot.status === "parsing" ? { status: "failed", fileName: slot.fileName, error: event.error } : slot;
      return {
        original: failParsing(state.original),
        modified: failParsing(state.modified),
        comparison: state.comparison.status === "running" ? { status: "failed", error: event.error } : state.comparison,
      };
    }
  }
}

export function reducer(state: AppState, event: AppEvent): AppState {
  const next = transition(state, event);
  if (next === null) {
    if (import.meta.env?.DEV) console.debug("[state] rejected transition", event.type, "from", state);
    return state;
  }
  return next;
}

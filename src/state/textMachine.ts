/**
 * State machine for the text / JSON mode. See README "State machine" for the tables.
 *
 * Text slot:  empty | reading | ready | failed
 * Comparison: idle | running | done | failed
 * No terminal states. `transitionText` returns null for any event no rule allows.
 */
import type { PackedTextDiff } from "../text/pack";
import type { TextInput } from "../text/types";
import type { Side } from "../worker/protocol";

export type TextSlot =
  | { status: "empty" }
  | { status: "reading"; fileName: string; requestId: number }
  | { status: "ready"; text: string; fileName: string | null }
  | { status: "failed"; fileName: string; error: string };

export type TextComparison =
  | { status: "idle" }
  /** `previous` keeps the last result on screen while the new one is computed. */
  | { status: "running"; requestId: number; previous: { diff: PackedTextDiff; diffMs: number } | null }
  | { status: "done"; diff: PackedTextDiff; diffMs: number }
  | { status: "failed"; error: string };

export interface TextState {
  original: TextSlot;
  modified: TextSlot;
  comparison: TextComparison;
}

export type TextEvent =
  | { type: "TEXT_EDITED"; side: Side; text: string }
  | { type: "FILE_SELECTED"; side: Side; fileName: string; requestId: number }
  | { type: "FILE_READ_SUCCEEDED"; side: Side; requestId: number; text: string }
  | { type: "FILE_READ_FAILED"; side: Side; requestId: number; error: string }
  | { type: "CLEARED"; side: Side }
  | { type: "SWAPPED" }
  | { type: "RESTORED"; original: TextInput; modified: TextInput }
  | { type: "DIFF_STARTED"; requestId: number }
  | { type: "DIFF_SUCCEEDED"; requestId: number; diff: PackedTextDiff; diffMs: number }
  | { type: "DIFF_FAILED"; requestId: number; error: string }
  | { type: "WORKER_CRASHED"; error: string };

export const INITIAL_TEXT_STATE: TextState = {
  original: { status: "empty" },
  modified: { status: "empty" },
  comparison: { status: "idle" },
};

/**
 * Guard for DIFF_STARTED: both sides hold text. A comparison against an empty side only
 * reported every line as removed, which is noise while the user is still filling the second side.
 */
export function isComparable(s: Pick<TextState, "original" | "modified">): boolean {
  return s.original.status === "ready" && s.modified.status === "ready";
}

/**
 * Apply a slot change; drop to idle when slots stop being comparable.
 * If a diff was in flight, invalidate its requestId so stale worker replies during debounce cannot land.
 */
function withSlots(state: TextState, original: TextSlot, modified: TextSlot): TextState {
  const next = { ...state, original, modified };
  if (!isComparable(next)) return { ...next, comparison: { status: "idle" } };
  if (state.comparison.status === "running") {
    const prev = state.comparison.previous;
    return { ...next, comparison: prev ? { status: "done", diff: prev.diff, diffMs: prev.diffMs } : { status: "idle" } };
  }
  return next;
}

function setSlot(state: TextState, side: Side, slot: TextSlot): TextState {
  return side === "original" ? withSlots(state, slot, state.modified) : withSlots(state, state.original, slot);
}

export function transitionText(state: TextState, event: TextEvent): TextState | null {
  switch (event.type) {
    case "TEXT_EDITED": {
      const prev = state[event.side];
      const fileName = prev.status === "ready" ? prev.fileName : null;
      return setSlot(state, event.side, event.text === "" ? { status: "empty" } : { status: "ready", text: event.text, fileName });
    }

    case "FILE_SELECTED":
      return setSlot(state, event.side, { status: "reading", fileName: event.fileName, requestId: event.requestId });

    case "FILE_READ_SUCCEEDED":
    case "FILE_READ_FAILED": {
      const slot = state[event.side];
      if (slot.status !== "reading" || slot.requestId !== event.requestId) return null;
      return setSlot(
        state,
        event.side,
        event.type === "FILE_READ_SUCCEEDED"
          ? { status: "ready", text: event.text, fileName: slot.fileName }
          : { status: "failed", fileName: slot.fileName, error: event.error },
      );
    }

    case "CLEARED":
      if (state[event.side].status === "empty") return null;
      return setSlot(state, event.side, { status: "empty" });

    case "SWAPPED":
      if (state.original.status === "reading" || state.modified.status === "reading") return null;
      return withSlots(state, state.modified, state.original);

    case "RESTORED": {
      const toSlot = (input: TextInput): TextSlot =>
        input.text === "" ? { status: "empty" } : { status: "ready", fileName: input.name, text: input.text };
      return {
        original: toSlot(event.original),
        modified: toSlot(event.modified),
        comparison: { status: "idle" },
      };
    }

    case "DIFF_STARTED": {
      if (!isComparable(state)) return null;
      const c = state.comparison;
      const previous = c.status === "done" ? { diff: c.diff, diffMs: c.diffMs } : c.status === "running" ? c.previous : null;
      return { ...state, comparison: { status: "running", requestId: event.requestId, previous } };
    }

    case "DIFF_SUCCEEDED":
    case "DIFF_FAILED": {
      const c = state.comparison;
      if (c.status !== "running" || c.requestId !== event.requestId) return null;
      return {
        ...state,
        comparison:
          event.type === "DIFF_SUCCEEDED"
            ? { status: "done", diff: event.diff, diffMs: event.diffMs }
            : { status: "failed", error: event.error },
      };
    }

    case "WORKER_CRASHED": {
      if (state.comparison.status !== "running") return state;
      return { ...state, comparison: { status: "failed", error: event.error } };
    }
  }
}

export function textReducer(state: TextState, event: TextEvent): TextState {
  const next = transitionText(state, event);
  if (next === null) {
    if (import.meta.env?.DEV) console.debug("[text-state] rejected transition", event.type, "from", state);
    return state;
  }
  return next;
}

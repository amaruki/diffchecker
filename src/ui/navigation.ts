/**
 * Next / previous difference navigation shared by the spreadsheet and text views.
 * Callers supply `positions`: sorted indexes (into their visible list) of the
 * stops, and `currentPos`: the visible index of the current selection or -1.
 */
import { useCallback, useEffect } from "react";

/** First index in `arr` whose value is >= x (or arr.length if none). */
export function lowerBound(arr: Int32Array, x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index in `arr` whose value is > x (or arr.length if none). */
export function upperBound(arr: Int32Array, x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]! <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function isInteractiveOrTyping(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}

export interface DiffNavigation {
  next: () => void;
  prev: () => void;
  /** Index into `positions` of the current stop, or -1 when the selection is not on a stop. */
  current: number;
}

/**
 * Wraps around at both ends. Keys: n / j / F8 = next, p / k / N / Shift+F8 = previous.
 * Keys are ignored while typing in a form field, when any modal <dialog> is open,
 * and when `enabled` is false (a hidden mode must not react).
 */
export function useDiffNavigation(
  positions: Int32Array,
  currentPos: number,
  goTo: (visibleIndex: number) => void,
  enabled = true,
): DiffNavigation {
  const next = useCallback(() => {
    if (positions.length === 0) return;
    const i = upperBound(positions, currentPos);
    goTo(positions[i < positions.length ? i : 0]!);
  }, [positions, currentPos, goTo]);

  const prev = useCallback(() => {
    if (positions.length === 0) return;
    const i = lowerBound(positions, currentPos < 0 ? Number.MAX_SAFE_INTEGER : currentPos) - 1;
    goTo(positions[i >= 0 ? i : positions.length - 1]!);
  }, [positions, currentPos, goTo]);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (
        e.defaultPrevented ||
        document.querySelector("dialog[open]") ||
        target?.closest('dialog, [role="dialog"]') ||
        isInteractiveOrTyping(e.target) ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey
      ) {
        return;
      }
      if (e.key === "n" || e.key === "j" || (e.key === "F8" && !e.shiftKey)) {
        e.preventDefault();
        next();
      } else if (e.key === "p" || e.key === "k" || e.key === "N" || (e.key === "F8" && e.shiftKey)) {
        e.preventDefault();
        prev();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, enabled]);

  const i = currentPos >= 0 ? lowerBound(positions, currentPos) : -1;
  return { next, prev, current: i >= 0 && i < positions.length && positions[i] === currentPos ? i : -1 };
}

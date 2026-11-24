import { useCallback, useRef, type RefObject } from "react";

const SUBPIXEL_EPSILON = 0.5;

/**
 * Paired scroll sync with a leader lock and subpixel deadband.
 * Prevents mirrored scroll events from rubber-banding the active pane during
 * wheel/trackpad momentum scrolling or fractional HiDPI/browser zoom.
 */
export function useScrollSync(leftRef: RefObject<HTMLElement | null>, rightRef: RefObject<HTMLElement | null>) {
  const leaderRef = useRef<"left" | "right" | null>(null);
  const rafRef = useRef(0);

  const sync = useCallback(
    (source: "left" | "right") => {
      if (leaderRef.current !== null && leaderRef.current !== source) return;
      const from = source === "left" ? leftRef.current : rightRef.current;
      const to = source === "left" ? rightRef.current : leftRef.current;
      if (!from || !to) return;

      leaderRef.current = source;
      if (Math.abs(to.scrollTop - from.scrollTop) > SUBPIXEL_EPSILON) to.scrollTop = from.scrollTop;
      if (Math.abs(to.scrollLeft - from.scrollLeft) > SUBPIXEL_EPSILON) to.scrollLeft = from.scrollLeft;

      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        leaderRef.current = null;
        rafRef.current = 0;
      });
    },
    [leftRef, rightRef],
  );

  const onLeftScroll = useCallback(() => sync("left"), [sync]);
  const onRightScroll = useCallback(() => sync("right"), [sync]);

  return { onLeftScroll, onRightScroll };
}

/** Pure stateless helper for direct/non-hook callers and unit tests. */
export function syncScroll(from: RefObject<HTMLElement | null>, to: RefObject<HTMLElement | null>): () => void {
  return () => {
    const a = from.current;
    const b = to.current;
    if (!a || !b) return;
    if (Math.abs(b.scrollTop - a.scrollTop) > SUBPIXEL_EPSILON) b.scrollTop = a.scrollTop;
    if (Math.abs(b.scrollLeft - a.scrollLeft) > SUBPIXEL_EPSILON) b.scrollLeft = a.scrollLeft;
  };
}

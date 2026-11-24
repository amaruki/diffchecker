import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { ROW_STATUS } from "../core/pack";

interface ChangeRulerProps {
  /** Status code (index into ROW_STATUS) of each displayed row; 0 ("same") draws nothing. */
  codes: Uint8Array;
  /** The pane whose scroll position the ruler shows and controls. */
  scrollRef: RefObject<HTMLDivElement | null>;
  rowHeight: number;
  /** Height above the first row inside the scroll content (a sticky header). */
  headerHeight?: number;
}

const COLOR_VAR: Record<string, string> = { added: "--add-fg", removed: "--rem-fg", changed: "--chg-fg" };
/** Every mark is at least this tall, so one changed row in 50,000 stays visible. */
const MIN_MARK_PX = 2;

function useDarkScheme(): boolean {
  const root = document.documentElement;
  const [dark, setDark] = useState(() => root.classList.contains("dark"));
  useEffect(() => {
    const update = () => setDark(root.classList.contains("dark"));
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    update();
    return () => observer.disconnect();
  }, [root]);
  return dark;
}

/**
 * Overview of where every change sits in the whole sheet or file, with the visible window
 * outlined. Click or drag to scroll there. Hidden from assistive technology: the
 * Previous / Next buttons give the same navigation by keyboard.
 */
export function ChangeRuler({ codes, scrollRef, rowHeight, headerHeight = 0 }: ChangeRulerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [height, setHeight] = useState(0);
  const [view, setView] = useState({ top: 0, size: 1 });
  const dark = useDarkScheme();
  const n = codes.length;

  // Track the ruler's own height.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(([entry]) => setHeight(entry?.contentRect.height ?? 0));
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // Track the visible window of the pane as fractions of the rows.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const total = Math.max(1, n * rowHeight);
      setView({ top: Math.max(0, el.scrollTop) / total, size: Math.min(1, Math.max(0, el.clientHeight - headerHeight) / total) });
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [scrollRef, n, rowHeight, headerHeight]);

  // Draw the marks. One pass over the rows; adjacent rows of one status merge into one rectangle.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (n === 0) return;
    const style = getComputedStyle(canvas);
    const colors = ROW_STATUS.map((s) => (COLOR_VAR[s] ? style.getPropertyValue(COLOR_VAR[s]).trim() : ""));
    const scale = height / n;
    let v = 0;
    while (v < n) {
      const code = codes[v]!;
      let end = v + 1;
      while (end < n && codes[end] === code) end++;
      if (code !== 0) {
        ctx.fillStyle = colors[code] ?? "";
        const y = v * scale;
        ctx.fillRect(2, Math.min(y, height - MIN_MARK_PX), Math.max(1, width - 4), Math.max(MIN_MARK_PX, (end - v) * scale));
      }
      v = end;
    }
  }, [codes, n, height, dark]);

  const scrollTo = (e: PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el || n === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    el.scrollTop = fraction * n * rowHeight - (el.clientHeight - headerHeight) / 2;
  };

  return (
    <div
      className="relative hidden touch-none cursor-pointer overflow-hidden bg-surface-subtle/80 min-[901px]:block"
      aria-hidden
      title="Overview of changes — click or drag to scroll"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        scrollTo(e);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) scrollTo(e);
      }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 size-full" />
      <div
        className="pointer-events-none absolute inset-x-0 border-y border-signal/70 bg-signal/15"
        style={{ top: `${view.top * 100}%`, height: `max(8px, ${view.size * 100}%)` }}
      />
    </div>
  );
}

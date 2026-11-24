import { sideLabel } from "./styles";
import { useEffect, useRef, useState, type DragEvent } from "react";
import type { Side } from "../worker/protocol";
import { Icon } from "./Icon";

interface DropOverlayProps {
  /** Only the visible mode (and when no modal dialog is open) listens. */
  enabled: boolean;
  /** Current file name per side, or null when the side is empty. */
  names: Record<Side, string | null>;
  /** Same contract as the slot drop zones: two files fill both sides in order. */
  onFiles: (side: Side, files: File[]) => void;
}

const dropTarget =
  "flex min-h-0 flex-col items-center justify-center gap-2.5 rounded-xl border-2 border-dashed border-border-strong bg-card/95 px-6 text-center shadow-sm motion-safe:transition-[border-color,background-color] [&>*]:pointer-events-none data-[over=true]:border-signal data-[over=true]:bg-signal-subtle/80";

const SIDES: Side[] = ["original", "modified"];

const hasFiles = (e: { dataTransfer: DataTransfer | null }) => e.dataTransfer?.types.includes("Files") ?? false;

/** Count only `kind === "file"` items so OS `text/uri-list` companions do not misreport 1 file as 2. */
function fileItemCount(dt: DataTransfer | null): number {
  if (!dt?.items) return 0;
  let n = 0;
  for (let i = 0; i < dt.items.length; i++) {
    if (dt.items[i]?.kind === "file") n++;
  }
  return n;
}

/**
 * Full-page drop target shown while files are dragged over the window.
 * Dragging text (not files) into an editor is not affected.
 */
export function DropOverlay({ enabled, names, onFiles }: DropOverlayProps) {
  /** Number of dragged files; 0 when the browser does not report it before the drop. Null: no drag. */
  const [dragCount, setDragCount] = useState<number | null>(null);
  const [over, setOver] = useState<Side | null>(null);
  const depthRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      depthRef.current = 0;
      setDragCount(null);
      setOver(null);
      return;
    }
    const end = () => {
      depthRef.current = 0;
      setDragCount(null);
      setOver(null);
    };
    const onEnter = (e: globalThis.DragEvent) => {
      if (!hasFiles(e)) return;
      depthRef.current++;
      setDragCount(fileItemCount(e.dataTransfer));
    };
    const onLeave = (e: globalThis.DragEvent) => {
      if (!hasFiles(e)) return;
      depthRef.current = Math.max(0, depthRef.current - 1);
      if (depthRef.current === 0) end();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") end();
    };
    const onVisibility = () => {
      if (document.hidden) end();
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", end);
    window.addEventListener("dragend", end);
    window.addEventListener("blur", end);
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      depthRef.current = 0;
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", end);
      window.removeEventListener("dragend", end);
      window.removeEventListener("blur", end);
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled]);

  if (!enabled || dragCount === null) return null;
  const pair = dragCount >= 2;

  const onDrop = (side: Side) => (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    depthRef.current = 0;
    setDragCount(null);
    setOver(null);
    onFiles(side, Array.from(e.dataTransfer.files));
  };

  return (
    <div
      className={`fixed inset-0 z-50 grid min-h-0 gap-3 bg-background/85 p-4 backdrop-blur-xs ${pair ? "grid-cols-1" : "grid-cols-1 grid-rows-2 min-[721px]:grid-cols-2 min-[721px]:grid-rows-1"}`}
    >
      {pair ? (
        <div className={dropTarget} data-over="true" onDragOver={(e) => e.preventDefault()} onDrop={onDrop("original")}>
          <span className="grid size-10 place-items-center rounded-lg border border-signal/30 bg-card text-signal">
            <Icon name="upload" size={18} />
          </span>
          <span className="text-base font-semibold text-foreground wrap-anywhere">
            {dragCount === 2 ? "Drop to compare both files" : `Drop to compare the first 2 of ${dragCount} files`}
          </span>
          <span className="max-w-md text-xs text-pretty text-muted-foreground">
            The first file loads as Original and the second as Modified. You can swap them afterwards.
          </span>
        </div>
      ) : (
        SIDES.map((side) => (
          <div
            key={side}
            className={dropTarget}
            data-over={over === side}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(side);
            }}
            onDragLeave={() => setOver((cur) => (cur === side ? null : cur))}
            onDrop={onDrop(side)}
          >
            <span className={sideLabel} data-side={side}>
              {side === "original" ? "Original" : "Modified"}
            </span>
            <span className="text-base font-semibold text-foreground wrap-anywhere">
              {names[side] ? `Replace ${names[side]}` : `Drop as ${side === "original" ? "Original" : "Modified"}`}
            </span>
            <span className="text-xs text-muted-foreground">Drop two files anywhere to replace both sides.</span>
          </div>
        ))
      )}
    </div>
  );
}

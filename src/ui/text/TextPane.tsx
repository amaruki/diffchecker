import { paneFrame, paneTitle, paneScroll, ghostPattern, gutterStatus } from "../styles";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { KeyboardEvent, MouseEvent, ReactNode, RefObject } from "react";
import { ROW_STATUS } from "../../core/pack";
import { highlightsAt, lineAt, type PackedHighlights, type PackedLines, type PackedTextRows } from "../../text/pack";
import type { Range } from "../../text/types";

export const LINE_H = 22;
const GUTTER_W = 52;
/** Characters rendered per line; longer lines are cut with a marker (the full text is still compared). */
export const MAX_RENDER_CHARS = 4000;

interface TextPaneProps {
  side: "orig" | "mod";
  sideText: string;
  fileName: string;
  lines: PackedLines;
  rows: PackedTextRows;
  highlights: PackedHighlights;
  visible: Int32Array;
  /** O(1) lookup from aligned row index `k` to visible index `v` (or -1 if hidden). */
  kToV: Int32Array;
  /** Widest line across both panes, so both scroll to the same width. */
  widthChars: number;
  selectedK: number;
  onSelect: (k: number) => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
}

function renderSegments(text: string, ranges: Range[], cls: string): ReactNode {
  if (ranges.length === 0) return text;
  const out: ReactNode[] = [];
  let pos = 0;
  ranges.forEach(([s, e], i) => {
    if (s >= text.length) return;
    if (s > pos) out.push(text.slice(pos, s));
    out.push(
      <mark key={i} className={cls}>
        {text.slice(s, Math.min(e, text.length))}
      </mark>,
    );
    pos = Math.min(e, text.length);
  });
  if (pos < text.length) out.push(text.slice(pos));
  return out;
}

const lineLayout = "group absolute inset-x-0 flex items-center whitespace-pre";
const lineGutter = `sticky left-0 z-1 mr-2.5 flex h-full shrink-0 select-none items-center justify-end border-r border-border/80 bg-surface-subtle pr-2 font-mono text-[11px] text-muted-foreground tabular-nums ${gutterStatus}`;
const lineTone = {
  added: "bg-add-tint",
  removed: "bg-remove-tint",
  changed: "bg-change-tint",
  ghost: ghostPattern,
  same: "",
} as const;

export function TextPane({
  side,
  sideText,
  fileName,
  lines,
  rows,
  highlights,
  visible,
  kToV,
  widthChars,
  selectedK,
  onSelect,
  scrollRef,
  onScroll,
}: TextPaneProps) {
  const rowV = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => LINE_H,
    overscan: 8,
    useFlushSync: false,
  });
  const sideRows = side === "orig" ? rows.orig : rows.mod;
  const hlClass = side === "orig" ? "rounded-[2px] bg-remove-mark text-inherit" : "rounded-[2px] bg-add-mark text-inherit";
  const fullTitle = `${sideText} · ${fileName}`;

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-k]");
    if (target) onSelect(Number(target.dataset.k));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || visible.length === 0) return;
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (step === 0 && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const el = event.currentTarget;
    let targetIdx: number;
    if (event.key === "Home") {
      targetIdx = 0;
      while (targetIdx < visible.length && visible[targetIdx]! < 0) targetIdx++;
    } else if (event.key === "End") {
      targetIdx = visible.length - 1;
      while (targetIdx >= 0 && visible[targetIdx]! < 0) targetIdx--;
    } else {
      const curIdx = selectedK >= 0 && selectedK < kToV.length ? kToV[selectedK]! : -1;
      if (curIdx < 0) {
        // When nothing is selected, select the top visible line directly rather than skipping it.
        targetIdx = Math.min(visible.length - 1, Math.max(0, Math.floor(el.scrollTop / LINE_H)));
        const dir = step > 0 ? 1 : -1;
        while (targetIdx >= 0 && targetIdx < visible.length && visible[targetIdx]! < 0) targetIdx += dir;
        if (targetIdx < 0 || targetIdx >= visible.length) {
          targetIdx = Math.min(visible.length - 1, Math.max(0, Math.floor(el.scrollTop / LINE_H)));
          while (targetIdx >= 0 && targetIdx < visible.length && visible[targetIdx]! < 0) targetIdx -= dir;
        }
      } else {
        targetIdx = curIdx + step;
        while (targetIdx >= 0 && targetIdx < visible.length && visible[targetIdx]! < 0) targetIdx += step;
      }
    }
    if (targetIdx < 0 || targetIdx >= visible.length) return;
    const nextK = visible[targetIdx]!;
    if (nextK < 0) return;
    onSelect(nextK);
    const top = targetIdx * LINE_H;
    if (top < el.scrollTop || top + LINE_H > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, top - el.clientHeight / 3);
    }
  };

  return (
    <div className={paneFrame}>
      <div className={paneTitle} data-side={side} title={fullTitle}>
        <span className={`size-1.5 shrink-0 rounded-full ${side === "mod" ? "bg-signal" : "bg-muted-foreground/65"}`} aria-hidden />
        <span className="shrink-0 font-medium text-foreground">{sideText}</span>
        <span className="text-border-strong" aria-hidden>
          /
        </span>
        <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{fileName}</span>
      </div>

      <div
        className={paneScroll}
        ref={scrollRef}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="region"
        aria-label={fullTitle}
        aria-describedby="line-navigation"
      >
        <div
          className="relative font-mono text-[12.5px] [tab-size:4]"
          style={{ height: rowV.getTotalSize(), width: `calc(${GUTTER_W}px + ${widthChars + 2}ch)`, minWidth: "100%" }}
          onClick={onClick}
        >
          {rowV.getVirtualItems().map((vr) => {
            const entry = visible[vr.index]!;
            const style = { top: vr.start, height: LINE_H };
            if (entry < 0) {
              return (
                <div
                  key={vr.index}
                  className={`${lineLayout} border-y border-border/60 bg-surface-subtle/90 text-[11px] text-muted-foreground italic`}
                  style={style}
                >
                  <span className={lineGutter} style={{ width: GUTTER_W }} />
                  <span className="pr-4">
                    ⋯ {(-entry).toLocaleString()} unchanged line{entry === -1 ? "" : "s"}
                  </span>
                </div>
              );
            }
            const k = entry;
            const line = sideRows[k]!;
            const status = ROW_STATUS[rows.status[k]!]!;
            const displayStatus = (status === "added" && side === "orig") || (status === "removed" && side === "mod") ? "ghost" : status;
            let text = line >= 0 ? lineAt(lines, line) : "";
            const cut = text.length > MAX_RENDER_CHARS;
            if (cut) text = text.slice(0, MAX_RENDER_CHARS);
            return (
              <div
                key={vr.index}
                className={`${lineLayout} ${lineTone[displayStatus]} cursor-text data-[line-selected=true]:outline-1 data-[line-selected=true]:-outline-offset-1 data-[line-selected=true]:outline-ring`}
                data-status={displayStatus}
                data-selected={k === selectedK}
                data-line-selected={k === selectedK}
                style={style}
                data-k={k}
              >
                <span
                  data-gutter-status={displayStatus}
                  className={`${lineGutter} group-data-[selected=true]:bg-signal-subtle`}
                  style={{ width: GUTTER_W }}
                >
                  {line >= 0 ? line + 1 : ""}
                </span>
                <span className="pr-4">
                  {status === "changed" ? renderSegments(text, highlightsAt(highlights, k), hlClass) : text}
                  {cut && <span className="text-muted-foreground"> … (line cut at {MAX_RENDER_CHARS.toLocaleString()} characters)</span>}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

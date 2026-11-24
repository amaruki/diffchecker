import { paneLayout, paneFrame, paneTitle, paneScroll, ghostPattern, gutterStatus } from "./styles";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useImperativeHandle, useMemo, useRef, type KeyboardEvent, type MouseEvent, type ReactNode, type Ref, type RefObject } from "react";
import { cellCodeAt, cellFormula, cellIndex, cellText, CellCode, ROW_STATUS, type PackedGrid, type PackedRows, type PackedSheet, type PackedSheetDiff } from "../core/pack";
import { ChangeRuler } from "./ChangeRuler";
import { cellAddress, columnName, parseColumnName } from "./columns";
import { lowerBound } from "./navigation";
import { useScrollSync } from "./scrollSync";

const ROW_H = 28;
const COL_W = 144;
const ROWNUM_W = 52;
const HEADER_H = 26;

export interface Selection {
  /** Aligned row index (into sheet.rows). */
  k: number;
  col: number;
}

export interface DiffGridHandle {
  /** Scroll both panes so visible row `v` and column `col` are in view. */
  reveal(v: number, col: number): void;
}

interface DiffGridProps {
  sheet: PackedSheetDiff;
  left: PackedSheet | null;
  right: PackedSheet | null;
  leftFile: string;
  leftSheet: string;
  rightFile: string;
  rightSheet: string;
  /** Aligned row indexes to show, in order. */
  visible: Int32Array;
  selected: Selection | null;
  onSelect: (s: Selection) => void;
  showFormulas: boolean;
  ref?: Ref<DiffGridHandle>;
}

type PaneSide = "orig" | "mod";

/** Cells covered by a merge (excluding the top-left anchor), and anchor → range. */
interface MergeInfo {
  covered: Set<string>;
  anchors: Map<string, string>;
}

const MERGE_AREA_LIMIT = 100_000;
const RANGE_RE = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/;

function mergeInfo(merges: string[]): MergeInfo {
  const covered = new Set<string>();
  const anchors = new Map<string, string>();
  for (const range of merges) {
    const m = RANGE_RE.exec(range);
    if (!m) continue;
    const c0 = parseColumnName(m[1]!) ?? 0;
    const r0 = Number(m[2]) - 1;
    const c1 = m[3] ? (parseColumnName(m[3]) ?? c0) : c0;
    const r1 = m[4] ? Number(m[4]) - 1 : r0;
    anchors.set(`${r0}:${c0}`, range);
    if ((r1 - r0 + 1) * (c1 - c0 + 1) > MERGE_AREA_LIMIT) continue;
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (r !== r0 || c !== c0) covered.add(`${r}:${c}`);
  }
  return { covered, anchors };
}

export function DiffGrid({
  sheet,
  left,
  right,
  leftFile,
  leftSheet,
  rightFile,
  rightSheet,
  visible,
  selected,
  onSelect,
  showFormulas,
  ref,
}: DiffGridProps) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const { onLeftScroll, onRightScroll } = useScrollSync(leftRef, rightRef);
  const leftMerges = useMemo(() => mergeInfo(left?.merges ?? []), [left]);
  const rightMerges = useMemo(() => mergeInfo(right?.merges ?? []), [right]);
  const codes = useMemo(() => Uint8Array.from(visible, (k) => sheet.rows.status[k]!), [visible, sheet]);

  useImperativeHandle(ref, () => ({
    reveal(v, col) {
      if (leftRef.current) revealCell(leftRef.current, v, col);
    },
  }));

  const common = { rows: sheet.rows, visible, colCount: Math.max(sheet.colCount, 1), selected, onSelect, showFormulas };
  return (
    <div className={paneLayout}>
      <Pane
        {...common}
        side="orig"
        sideText="Original"
        fileName={leftFile}
        sheetName={leftSheet}
        grid={left?.grid ?? null}
        other={null}
        merges={leftMerges}
        scrollRef={leftRef}
        onScroll={onLeftScroll}
      />
      <Pane
        {...common}
        side="mod"
        sideText="Modified"
        fileName={rightFile}
        sheetName={rightSheet}
        grid={right?.grid ?? null}
        other={left?.grid ?? null}
        merges={rightMerges}
        scrollRef={rightRef}
        onScroll={onRightScroll}
      />
      <ChangeRuler codes={codes} scrollRef={leftRef} rowHeight={ROW_H} headerHeight={HEADER_H} />
    </div>
  );
}

function revealCell(el: HTMLDivElement, row: number, col: number) {
  const rowTop = row * ROW_H;
  const viewHeight = el.clientHeight - HEADER_H;
  if (rowTop < el.scrollTop || rowTop + ROW_H > el.scrollTop + viewHeight) {
    el.scrollTop = Math.max(0, rowTop - viewHeight / 2 + ROW_H / 2);
  }
  const colLeft = col * COL_W;
  const viewWidth = el.clientWidth - ROWNUM_W;
  if (colLeft < el.scrollLeft || colLeft + COL_W > el.scrollLeft + viewWidth) {
    el.scrollLeft = Math.max(0, colLeft - viewWidth / 2 + COL_W / 2);
  }
}

const CELL_MOVES: Partial<Record<string, readonly [row: number, column: number]>> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

interface PaneProps {
  side: PaneSide;
  sideText: string;
  fileName: string;
  sheetName: string;
  grid: PackedGrid | null;
  /** The original grid, used by the modified pane to show old values of changed cells. */
  other: PackedGrid | null;
  rows: PackedRows;
  visible: Int32Array;
  colCount: number;
  merges: MergeInfo;
  selected: Selection | null;
  onSelect: (s: Selection) => void;
  showFormulas: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
}

function displayText(grid: PackedGrid, i: number, showFormulas: boolean): string {
  if (showFormulas) {
    const f = cellFormula(grid, i);
    if (f !== null) return "=" + f;
  }
  return cellText(grid, i);
}

function cellClass(code: CellCode, side: PaneSide): string {
  switch (code) {
    case CellCode.None:
      return "";
    case CellCode.Added:
      return side === "mod" ? "bg-add-tint text-add" : ghostPattern;
    case CellCode.Removed:
      return side === "orig" ? "bg-remove-tint text-remove" : ghostPattern;
    default:
      return "bg-change-tint";
  }
}

function Pane({
  side,
  sideText,
  fileName,
  sheetName,
  grid,
  other,
  rows,
  visible,
  colCount,
  merges,
  selected,
  onSelect,
  showFormulas,
  scrollRef,
  onScroll,
}: PaneProps) {
  const rowV = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 5,
    useFlushSync: false,
  });
  const colV = useVirtualizer({
    horizontal: true,
    count: colCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => COL_W,
    overscan: 1,
    useFlushSync: false,
  });
  const sideRows = side === "orig" ? rows.orig : rows.mod;
  const vCols = colV.getVirtualItems();
  const fullTitle = `${sideText} · ${fileName} · ${sheetName}`;

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-k]");
    if (!target) return;
    onSelect({ k: Number(target.dataset.k), col: Number(target.dataset.c) });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.shiftKey || visible.length === 0) return;
    const el = event.currentTarget;
    const index = selected ? lowerBound(visible, selected.k) : -1;
    const hasSelection = index >= 0 && index < visible.length && visible[index] === selected?.k;

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const curRow = hasSelection ? index : Math.min(visible.length - 1, Math.floor(el.scrollTop / ROW_H));
      const jumpDoc = event.ctrlKey || event.metaKey;
      const row = jumpDoc ? (event.key === "Home" ? 0 : visible.length - 1) : curRow;
      const col = event.key === "Home" ? 0 : colCount - 1;
      const k = visible[row];
      if (k === undefined) return;
      onSelect({ k, col });
      revealCell(el, row, col);
      return;
    }

    const move = CELL_MOVES[event.key];
    if (!move || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const row = Math.min(visible.length - 1, Math.max(0, hasSelection ? index + move[0] : Math.floor(el.scrollTop / ROW_H)));
    const col = Math.min(colCount - 1, Math.max(0, hasSelection && selected ? selected.col + move[1] : Math.floor(el.scrollLeft / COL_W)));
    const k = visible[row];
    if (k === undefined) return;
    onSelect({ k, col });
    revealCell(el, row, col);
  };

  const renderCell = (k: number, rowIdx: number, col: number, x: number): ReactNode => {
    const code = cellCodeAt(rows, k, col);
    const isSel = selected?.k === k && selected.col === col;
    const appearance = rowIdx < 0 ? ghostPattern : cellClass(code, side);
    const isFormulaChange = code === CellCode.ChangedFormula || code === CellCode.ChangedBoth;
    let content: ReactNode = null;
    let tip: string | undefined;
    if (rowIdx >= 0) {
      const key = `${rowIdx}:${col}`;
      const ci = grid ? cellIndex(grid, rowIdx, col) : -1;
      const text = grid && ci >= 0 ? displayText(grid, ci, showFormulas) : "";
      const formula = grid && ci >= 0 ? cellFormula(grid, ci) : null;
      tip = `${cellAddress(rowIdx, col)}${text ? `: ${text}` : ""}${formula && !showFormulas ? `\n=${formula}` : ""}`;
      const range = merges.anchors.get(key);
      if (range) tip += `\nMerged ${range}`;
      if (code >= CellCode.ChangedValue && side === "mod" && other) {
        const oi = cellIndex(other, rows.orig[k]!, col);
        const old = oi >= 0 ? displayText(other, oi, showFormulas) : "";
        content = (
          <>
            <s className="mr-1.5 text-remove/85 decoration-remove/60">{old}</s>
            <span className="font-medium text-foreground">{text}</span>
          </>
        );
        tip += `\nWas: ${old}`;
      } else {
        content = text;
      }
    }
    return (
      <div
        key={col}
        className={`absolute top-0 h-full cursor-cell truncate border-r border-b border-border/80 px-2 font-mono text-[12.5px] leading-7 ${appearance}
          data-[cell-selected=true]:z-1 data-[cell-selected=true]:outline-2 data-[cell-selected=true]:-outline-offset-2 data-[cell-selected=true]:outline-ring
          data-[merged=true]:bg-[radial-gradient(var(--merge-dot)_1px,transparent_1px)] data-[merged=true]:bg-size-[6px_6px]
          data-[formula=true]:pr-5 data-[formula=true]:after:absolute data-[formula=true]:after:top-0 data-[formula=true]:after:right-1.5 data-[formula=true]:after:font-sans data-[formula=true]:after:text-[11px] data-[formula=true]:after:font-semibold data-[formula=true]:after:text-change data-[formula=true]:after:content-['ƒ']`}
        data-cell-selected={isSel}
        data-merged={merges.covered.has(`${rowIdx}:${col}`)}
        data-formula={isFormulaChange && rowIdx >= 0}
        style={{ left: ROWNUM_W + x, width: COL_W }}
        title={tip}
        data-k={k}
        data-c={col}
      >
        {content}
      </div>
    );
  };

  return (
    <div className={paneFrame}>
      <div className={paneTitle} data-side={side} title={fullTitle}>
        <span className={`size-1.5 shrink-0 rounded-full ${side === "mod" ? "bg-signal" : "bg-muted-foreground/65"}`} aria-hidden />
        <span className="shrink-0 font-medium text-foreground">{sideText}</span>
        <span className="text-border-strong" aria-hidden>
          /
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">{fileName}</span>
        <span className="max-w-[45%] min-w-0 truncate font-mono text-[11px] text-muted-foreground">{sheetName}</span>
      </div>

      <div
        className={paneScroll}
        ref={scrollRef}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="region"
        aria-label={fullTitle}
        aria-describedby="cell-navigation"
      >
        <div
          className="relative"
          style={{ width: ROWNUM_W + colV.getTotalSize(), height: HEADER_H + rowV.getTotalSize() }}
          onClick={onClick}
        >
          <div className="sticky top-0 z-20 border-b border-border bg-surface-subtle" style={{ height: HEADER_H, width: ROWNUM_W + colV.getTotalSize() }}>
            <div className="sticky left-0 z-10 h-full border-r border-border bg-surface-subtle" style={{ width: ROWNUM_W }} />
            {vCols.map((c) => (
              <div
                key={c.index}
                className="absolute top-0 grid h-full place-items-center border-r border-border/80 font-mono text-[11px] font-medium text-muted-foreground data-[selected=true]:bg-signal-subtle data-[selected=true]:font-semibold data-[selected=true]:text-signal"
                data-selected={selected?.col === c.index}
                style={{ left: ROWNUM_W + c.start, width: COL_W }}
              >
                {columnName(c.index)}
              </div>
            ))}
          </div>

          {rowV.getVirtualItems().map((vr) => {
            const k = visible[vr.index]!;
            const rowIdx = sideRows[k]!;
            const status = ROW_STATUS[rows.status[k]!];
            return (
              <div
                key={vr.index}
                className="group absolute inset-x-0"
                data-status={status}
                data-selected={selected?.k === k}
                style={{ top: HEADER_H + vr.start, height: ROW_H }}
              >
                <div
                  data-gutter-status={status}
                  className={`sticky left-0 z-10 flex h-full items-center justify-end border-r border-b border-border/80 bg-surface-subtle pr-2 font-mono text-[11px] text-muted-foreground tabular-nums group-data-[selected=true]:bg-signal-subtle ${gutterStatus}`}
                  style={{ width: ROWNUM_W }}
                >
                  {rowIdx >= 0 ? rowIdx + 1 : ""}
                </div>
                {vCols.map((c) => renderCell(k, rowIdx, c.index, c.start))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

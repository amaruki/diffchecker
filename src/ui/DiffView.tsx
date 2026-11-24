import { Badge } from "@/components/ui/badge";
import { resultLayout, resultPlaceholder } from "./styles";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ROW_STATUS, type PackedSheetDiff, type PackedWorkbook, type PackedWorkbookDiff } from "../core/pack";
import type { DiffOptions } from "../core/types";
import { CellDetail } from "./CellDetail";
import { DiffGrid, type DiffGridHandle, type Selection } from "./DiffGrid";
import { DiffNav } from "./DiffNav";
import { useDiffNavigation } from "./navigation";
import { SummaryBar } from "./SummaryBar";
import { rowDiffCount, sheetTitle } from "./summary";

interface DiffViewProps {
  diff: PackedWorkbookDiff;
  original: PackedWorkbook;
  modified: PackedWorkbook;
  options: DiffOptions;
  onlyDiffs: boolean;
  diffMs: number;
  /** True while options are re-diffing the same workbook pair; keeps active sheet & scroll intact. */
  stale?: boolean;
  /** False while the spreadsheet mode is hidden or a modal is open: keyboard shortcuts stay off. */
  keysEnabled: boolean;
}

const SAME = ROW_STATUS.indexOf("same");

function visibleRows(sheet: PackedSheetDiff, onlyDiffs: boolean): Int32Array {
  const { status, length } = sheet.rows;
  if (!onlyDiffs) return Int32Array.from({ length }, (_, i) => i);
  let n = 0;
  for (let k = 0; k < length; k++) if (status[k] !== SAME) n++;
  const out = new Int32Array(n);
  for (let k = 0, j = 0; k < length; k++) if (status[k] !== SAME) out[j++] = k;
  return out;
}

/** Positions (indexes into `visible`) of rows that differ. Sorted ascending. */
function diffPositions(sheet: PackedSheetDiff, visible: Int32Array): Int32Array {
  const out: number[] = [];
  for (let v = 0; v < visible.length; v++) if (sheet.rows.status[visible[v]!] !== SAME) out.push(v);
  return Int32Array.from(out);
}

function firstDiffCol(sheet: PackedSheetDiff, k: number): number {
  const p = sheet.rows.cellPtr[k]!;
  return p < sheet.rows.cellPtr[k + 1]! ? sheet.rows.cellCol[p]! : 0;
}

function initialSheet(diff: PackedWorkbookDiff): number {
  const i = diff.sheets.findIndex((s) => !s.identical);
  return i === -1 ? 0 : i;
}

export function DiffView({ diff, original, modified, options, onlyDiffs, diffMs, stale = false, keysEnabled }: DiffViewProps) {
  const [active, setActive] = useState(() => initialSheet(diff));
  const [selected, setSelected] = useState<Selection | null>(null);
  const gridRef = useRef<DiffGridHandle>(null);

  // A new diff (options changed) may have fewer sheets; keep the active index valid.
  useEffect(() => {
    setActive((a) => (a < diff.sheets.length ? a : initialSheet(diff)));
    setSelected(null);
  }, [diff]);

  const sheet = diff.sheets[Math.min(active, diff.sheets.length - 1)]!;
  const left = sheet.origIndex >= 0 ? (original.sheets[sheet.origIndex] ?? null) : null;
  const right = sheet.modIndex >= 0 ? (modified.sheets[sheet.modIndex] ?? null) : null;
  const visible = useMemo(() => visibleRows(sheet, onlyDiffs), [sheet, onlyDiffs]);
  const positions = useMemo(() => diffPositions(sheet, visible), [sheet, visible]);

  /** Visible position of the selected row, or -1 when hidden by the filter. */
  const currentPos = useMemo(() => {
    if (!selected) return -1;
    let lo = 0;
    let hi = visible.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const k = visible[mid]!;
      if (k === selected.k) return mid;
      if (k < selected.k) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  }, [selected, visible]);

  const visibleSelection = currentPos >= 0 ? selected : null;

  const goTo = useCallback(
    (v: number) => {
      const k = visible[v];
      if (k === undefined) return;
      const col = firstDiffCol(sheet, k);
      setSelected({ k, col });
      gridRef.current?.reveal(v, col);
    },
    [visible, sheet],
  );

  const { next, prev, current: currentDiff } = useDiffNavigation(positions, currentPos, goTo, keysEnabled);
  const onDiffRow = currentDiff >= 0;

  const selectSheet = (i: number) => {
    setActive(i);
    setSelected(null);
  };

  return (
    <section className={`${resultLayout} data-[stale=true]:opacity-75`} data-stale={stale}>
      <div className="min-w-0 shrink-0 border-b border-border">
        <nav className="workbench-scroll -mb-px flex min-w-0 items-center gap-1 overflow-x-auto" aria-label="Sheets">
          {diff.sheets.map((s, i) => {
            const n = rowDiffCount(s.counts);
            const isActive = i === active;
            return (
              <button
                key={`${s.origIndex}:${s.modIndex}`}
                type="button"
                aria-current={isActive ? "page" : undefined}
                onClick={() => selectSheet(i)}
                className="group relative inline-flex min-h-9 shrink-0 select-none items-center gap-1.5 border-b-2 border-transparent px-3 py-1.5 text-[13px] font-medium text-muted-foreground motion-safe:transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-[current=page]:border-signal aria-[current=page]:text-foreground pointer-coarse:min-h-11"
              >
                <span className="max-w-64 truncate">{sheetTitle(s)}</span>
                {s.status !== "matched" && (
                  <Badge tone={s.status === "added" ? "add" : s.status === "removed" ? "rem" : "chg"}>{s.status}</Badge>
                )}
                {s.identical ? (
                  <>
                    <span className="text-xs font-semibold text-add" title="No differences" aria-hidden>
                      ✓
                    </span>
                    <span className="sr-only">No differences</span>
                  </>
                ) : (
                  n > 0 && (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[11px] leading-none text-muted-foreground tabular-nums group-aria-[current=page]:bg-signal-subtle group-aria-[current=page]:text-accent-foreground">
                      {n.toLocaleString()}
                      <span className="sr-only"> {n === 1 ? "difference" : "differences"}</span>
                    </span>
                  )
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <SummaryBar
        diff={diff}
        sheet={sheet}
        diffMs={diffMs}
        nav={
          <DiffNav
            onPrev={prev}
            onNext={next}
            total={positions.length}
            current={onDiffRow ? currentDiff : -1}
            noun="Difference"
            emptyText="No differing rows"
          />
        }
      />

      {visible.length === 0 ? (
        <p className={resultPlaceholder}>{onlyDiffs ? "No rows with differences in this sheet." : "This sheet is empty on both sides."}</p>
      ) : (
        <DiffGrid
          ref={gridRef}
          sheet={sheet}
          left={left}
          right={right}
          leftFile={original.fileName}
          leftSheet={sheet.origName ?? "(sheet not present)"}
          rightFile={modified.fileName}
          rightSheet={sheet.modName ?? "(sheet not present)"}
          visible={visible}
          selected={visibleSelection}
          onSelect={setSelected}
          showFormulas={options.compareMode === "formulas"}
        />
      )}

      <p id="cell-navigation" className="sr-only">
        Use the arrow keys, Home, and End to select a cell and read its details.
      </p>
      <CellDetail sheet={sheet} left={left} right={right} selected={visibleSelection} />
    </section>
  );
}

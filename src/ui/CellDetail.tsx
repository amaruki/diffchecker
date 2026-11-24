import { Badge } from "@/components/ui/badge";
import { panel } from "./styles";
import { cellCodeAt, cellIndex, readCell, CellCode, type CellView, type PackedSheet, type PackedSheetDiff } from "../core/pack";
import { cellAddress } from "./columns";
import type { Selection } from "./DiffGrid";

interface CellDetailProps {
  sheet: PackedSheetDiff;
  left: PackedSheet | null;
  right: PackedSheet | null;
  selected: Selection | null;
}

export const CODE_LABEL: Record<CellCode, string> = {
  [CellCode.None]: "Unchanged",
  [CellCode.Added]: "Added",
  [CellCode.Removed]: "Removed",
  [CellCode.ChangedValue]: "Value changed",
  [CellCode.ChangedFormula]: "Formula changed",
  [CellCode.ChangedBoth]: "Value and formula changed",
};

export const TYPE_LABEL: Record<CellView["type"], string> = { s: "text", n: "number", b: "boolean", d: "date", e: "error" };

function Side({ label, side, sheet, row, col }: { label: string; side: "orig" | "mod"; sheet: PackedSheet | null; row: number; col: number }) {
  if (!sheet || row < 0) {
    return (
      <div className="flex min-w-0 flex-1 items-baseline gap-2 rounded-md border border-border/60 bg-surface-subtle/50 px-2.5 py-1.5 text-xs">
        <span className="shrink-0 font-medium text-muted-foreground">{label}</span>
        <span className="text-muted-foreground italic">Row not present</span>
      </div>
    );
  }
  const i = cellIndex(sheet.grid, row, col);
  const cell = i >= 0 ? readCell(sheet.grid, i) : null;
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2.5 gap-y-1 rounded-md border border-border/70 bg-surface-subtle/50 px-2.5 py-1.5 text-xs wrap-anywhere">
      <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[11px] font-medium text-muted-foreground">
        <span className={`size-1.5 rounded-full ${side === "mod" ? "bg-signal" : "bg-muted-foreground/65"}`} aria-hidden />
        {label} {cellAddress(row, col)}
      </span>
      {cell ? (
        <>
          <span className="font-mono font-medium text-foreground wrap-anywhere">
            {cell.text === "" ? <em className="font-sans font-normal text-muted-foreground">(empty text)</em> : cell.text}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {TYPE_LABEL[cell.type]}
            {cell.raw !== cell.text && ` · raw ${cell.raw}`}
          </span>
          {cell.formula !== null && (
            <code className="rounded-[4px] bg-signal-subtle px-1.5 py-0.5 font-mono text-[11px] text-accent-foreground wrap-anywhere">
              ={cell.formula}
            </code>
          )}
        </>
      ) : (
        <span className="text-muted-foreground italic">Empty cell</span>
      )}
    </div>
  );
}

export function CellDetail({ sheet, left, right, selected }: CellDetailProps) {
  const valid = selected !== null && selected.k >= 0 && selected.k < sheet.rows.length;
  const code = valid ? cellCodeAt(sheet.rows, selected.k, selected.col) : null;
  const tone =
    code === null || code === CellCode.None ? "neutral" : code === CellCode.Added ? "add" : code === CellCode.Removed ? "rem" : "chg";

  // Keep the aria-live region persistently mounted so screen readers announce the very first selection.
  return (
    <div
      className={`${panel} flex shrink-0 flex-col gap-2 px-3 py-2 text-xs sm:flex-row sm:items-center`}
      aria-live="polite"
    >
      {valid && code !== null ? (
        <>
          <Badge tone={tone} className="self-start sm:self-center">
            {CODE_LABEL[code]}
          </Badge>
          <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
            <Side label="Original" side="orig" sheet={left} row={sheet.rows.orig[selected.k]!} col={selected.col} />
            <span className="hidden text-xs text-muted-foreground sm:inline" aria-hidden>
              →
            </span>
            <Side label="Modified" side="mod" sheet={right} row={sheet.rows.mod[selected.k]!} col={selected.col} />
          </div>
        </>
      ) : (
        <span className="text-muted-foreground">Select any cell to inspect values and formulas. Use arrow keys when a pane is focused.</span>
      )}
    </div>
  );
}

import { Badge } from "@/components/ui/badge";
import { summaryFrame, summaryRow, divider, kbdKey } from "./styles";
import type { ReactNode } from "react";
import type { PackedSheetDiff, PackedWorkbookDiff } from "../core/pack";
import { plural, rowDiffCount } from "./summary";

interface SummaryBarProps {
  diff: PackedWorkbookDiff;
  sheet: PackedSheetDiff;
  diffMs: number;
  /** Previous / Next controls, shown at the start of the current-sheet line. */
  nav: ReactNode;
}

const STAT_TONE = {
  add: "text-add",
  rem: "text-remove",
  chg: "text-change",
} as const;

export function Stat({ kind, sign, value, unit }: { kind: "add" | "rem" | "chg"; sign: string; value: number; unit: string }) {
  if (value === 0) return null;
  return (
    <span className={`inline-flex items-baseline gap-1 font-mono text-xs font-medium tabular-nums ${STAT_TONE[kind]}`}>
      <span>
        {sign}
        {value.toLocaleString()}
      </span>
      <span className="font-sans font-normal opacity-85">{value === 1 ? unit : `${unit}s`}</span>
    </span>
  );
}

function StatGroup({
  added,
  removed,
  changed,
  unit,
}: {
  added: number;
  removed: number;
  changed: number;
  unit: string;
}) {
  if (added === 0 && removed === 0 && changed === 0) return null;
  return (
    <span className="inline-flex items-baseline gap-1.5 font-mono text-xs tabular-nums">
      <span className="inline-flex items-baseline gap-1.5 font-medium">
        {added > 0 && <span className="text-add">+{added.toLocaleString()}</span>}
        {removed > 0 && <span className="text-remove">−{removed.toLocaleString()}</span>}
        {changed > 0 && <span className="text-change">~{changed.toLocaleString()}</span>}
      </span>
      <span className="font-sans text-muted-foreground">{unit}</span>
    </span>
  );
}

export function SummaryBar({ diff, sheet, diffMs, nav }: SummaryBarProps) {
  const t = diff.totals;
  const c = sheet.counts;
  const changedSheets = diff.sheets.filter((s) => !s.identical).length;
  const sheetDiffs = rowDiffCount(c);
  const multiSheet = diff.sheets.length > 1;

  return (
    <div className={summaryFrame}>
      <div className={summaryRow}>
        {nav}
        <span className={divider} />
        <span className="font-medium text-foreground tabular-nums">
          {sheetDiffs === 0 ? "No differences in this sheet" : `${plural(sheetDiffs, "difference")} in sheet`}
        </span>
        <div className="inline-flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <StatGroup added={c.addedRows} removed={c.removedRows} changed={c.changedRows} unit="rows" />
          <StatGroup added={c.addedCells} removed={c.removedCells} changed={c.changedCells} unit="cells" />
        </div>
        {c.mergeChanges > 0 && (
          <Badge tone="chg" className="whitespace-normal wrap-anywhere">
            merges:
            {sheet.mergesAdded.map((r) => ` +${r}`).join("")}
            {sheet.mergesRemoved.map((r) => ` −${r}`).join("")}
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-3">
          <KeyHint />
          {!multiSheet && (
            <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{Math.round(diffMs)} ms</span>
          )}
        </div>
      </div>

      {multiSheet && (
        <div className={`${summaryRow} border-t border-border bg-surface-subtle/50 py-1.5 text-muted-foreground`}>
          <span className="tabular-nums">
            Workbook: <strong className="font-medium text-foreground">{changedSheets}</strong> of {plural(diff.sheets.length, "sheet")} differ
          </span>
          {t.addedSheets > 0 && <Stat kind="add" sign="+" value={t.addedSheets} unit="sheet" />}
          {t.removedSheets > 0 && <Stat kind="rem" sign="−" value={t.removedSheets} unit="sheet" />}
          {t.renamedSheets > 0 && (
            <span className="inline-flex items-baseline gap-1 font-mono text-xs font-medium text-change tabular-nums">
              <span>~{t.renamedSheets.toLocaleString()}</span>
              <span className="font-sans font-normal opacity-85">renamed</span>
            </span>
          )}
          <span className={divider} />
          <div className="inline-flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <StatGroup added={t.addedRows} removed={t.removedRows} changed={t.changedRows} unit="rows" />
            <StatGroup added={t.addedCells} removed={t.removedCells} changed={t.changedCells} unit="cells" />
          </div>
          {diff.sheetOrderChanged && <span className="text-muted-foreground">sheet order changed</span>}
          <span className="ml-auto font-mono text-[11px] text-muted-foreground tabular-nums">{Math.round(diffMs)} ms</span>
        </div>
      )}
    </div>
  );
}

/** Shortcut reminder; hidden on touch devices, where it does not apply. */
export function KeyHint() {
  return (
    <span className="hidden items-center gap-1.5 text-[11px] text-muted-foreground min-[901px]:pointer-fine:inline-flex">
      <kbd className={kbdKey}>n</kbd>
      <span>next</span>
      <kbd className={kbdKey}>p</kbd>
      <span>prev</span>
    </span>
  );
}

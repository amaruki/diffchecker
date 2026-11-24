import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ArrowLeftIcon, HistoryIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CellCode, type CellView } from "../core/pack";
import type { DiffCounts, RowStatus } from "../core/types";
import type { ReportChange, ReportSheetSummary, WorkbookReport } from "../core/workbookReport";
import { CODE_LABEL, TYPE_LABEL } from "./CellDetail";
import { cellAddress, columnName } from "./columns";
import { MatchedState } from "./MatchedState";
import { infoBanner, panel, warningBanner } from "./styles";
import { plural } from "./summary";

const PAGE_SIZE = 50;
const ROW_LABEL: Record<RowStatus, string> = {
  same: "Unchanged row",
  added: "Row added",
  removed: "Row removed",
  changed: "Row changed",
};

function hasColumn(change: ReportChange): change is Extract<ReportChange, { column: number }> {
  return Object.hasOwn(change, "column");
}

function changeTone(change: ReportChange): "add" | "rem" | "chg" | "neutral" {
  if (hasColumn(change)) {
    if (change.code === CellCode.Added) return "add";
    if (change.code === CellCode.Removed) return "rem";
    if (change.code === CellCode.None) return "neutral";
    return "chg";
  }
  if (change.status === "added") return "add";
  if (change.status === "removed") return "rem";
  if (change.status === "changed") return "chg";
  return "neutral";
}

function title(sheet: ReportSheetSummary): string {
  if (sheet.status === "renamed") return `${sheet.originalName} → ${sheet.modifiedName}`;
  return sheet.modifiedName ?? sheet.originalName ?? "(unnamed)";
}

function countSummary(counts: DiffCounts): string {
  return [
    counts.addedRows && `${plural(counts.addedRows, "row")} added`,
    counts.removedRows && `${plural(counts.removedRows, "row")} removed`,
    counts.changedRows && `${plural(counts.changedRows, "row")} changed`,
    counts.mergeChanges && plural(counts.mergeChanges, "merge change"),
  ]
    .filter(Boolean)
    .join(" · ");
}

function sheetOption(sheet: ReportSheetSummary): string {
  if (sheet.status !== "matched") return sheet.status;
  return sheet.identical ? "Identical" : "Changed";
}

function SavedSettings({ options }: { options: WorkbookReport["options"] }) {
  const match = {
    aligned: "Detect inserted and deleted rows",
    index: "Same row numbers",
    key: `Key column ${columnName(options.keyColumn)}`,
  }[options.rowMatching];
  const ignores = [
    options.ignoreCase && "Letter case",
    options.trimWhitespace && "Leading and trailing spaces",
    options.ignoreEmpty && "Empty cells",
  ].filter(Boolean);

  return (
    <details className="text-xs">
      <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">Comparison settings</summary>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-muted-foreground">
        <dt>Match rows</dt>
        <dd className="text-foreground">{match}</dd>
        <dt>Compare cells by</dt>
        <dd className="text-foreground">{options.compareMode === "values" ? "Computed values" : "Formulas"}</dd>
        <dt>Ignore differences in</dt>
        <dd className="text-foreground">{ignores.join(", ") || "None"}</dd>
      </dl>
    </details>
  );
}

function ChangeValue({ row, column, cell }: { row: number; column?: number; cell?: CellView | null }) {
  if (row < 0) return <span className="text-muted-foreground italic">Row absent</span>;
  if (column === undefined) return <span className="font-mono text-muted-foreground">Row {(row + 1).toLocaleString()}</span>;
  return (
    <div className="min-w-0 space-y-1 wrap-anywhere">
      <p className="font-mono text-[11px] font-medium text-muted-foreground">{cellAddress(row, column)}</p>
      {cell ? (
        <>
          <p className="font-mono text-foreground whitespace-pre-wrap">
            {cell.text || <em className="font-sans text-muted-foreground">(empty text)</em>}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {TYPE_LABEL[cell.type]}
            {cell.raw !== cell.text && ` · raw ${cell.raw}`}
          </p>
          {cell.formula !== null && (
            <code className="inline-block rounded-[4px] bg-signal-subtle px-1.5 py-0.5 font-mono text-[11px] text-accent-foreground">
              ={cell.formula}
            </code>
          )}
        </>
      ) : (
        <p className="text-muted-foreground italic">Empty cell</p>
      )}
    </div>
  );
}

function ChangeList({ changes }: { changes: ReportChange[] }) {
  const [page, setPage] = useState(0);
  const prevRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const start = page * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, changes.length);

  const goPrev = () => {
    const nextPage = Math.max(0, page - 1);
    setPage(nextPage);
    if (nextPage === 0) requestAnimationFrame(() => nextRef.current?.focus());
  };

  const goNext = () => {
    const maxPage = Math.floor((changes.length - 1) / PAGE_SIZE);
    const nextPage = Math.min(maxPage, page + 1);
    setPage(nextPage);
    if (nextPage === maxPage) requestAnimationFrame(() => prevRef.current?.focus());
  };

  return (
    <>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full table-fixed text-left text-xs">
          <thead className="border-b border-border bg-surface-subtle">
            <tr className="[&_th]:px-3 [&_th]:py-2 [&_th]:font-medium [&_th]:text-muted-foreground">
              <th scope="col" className="w-44">
                Change
              </th>
              <th scope="col">Original</th>
              <th scope="col">Modified</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/80">
            {changes.slice(start, end).map((change, index) => {
              const cellChange = hasColumn(change);
              return (
                <tr key={start + index} className="align-top hover:bg-surface-subtle/40 [&_td]:px-3 [&_td]:py-2.5">
                  <td className="space-y-1 wrap-anywhere">
                    <Badge tone={changeTone(change)}>
                      {cellChange ? CODE_LABEL[change.code] : ROW_LABEL[change.status]}
                    </Badge>
                    {cellChange && (change.status === "added" || change.status === "removed") && (
                      <div className="text-[11px] text-muted-foreground">{ROW_LABEL[change.status]}</div>
                    )}
                  </td>
                  <td>
                    <ChangeValue
                      row={change.originalRow}
                      column={cellChange ? change.column : undefined}
                      cell={cellChange ? change.original : undefined}
                    />
                  </td>
                  <td>
                    <ChangeValue
                      row={change.modifiedRow}
                      column={cellChange ? change.column : undefined}
                      cell={cellChange ? change.modified : undefined}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {changes.length > PAGE_SIZE && (
        <nav aria-label="Saved change pages" className="flex flex-wrap items-center gap-2">
          <span className="mr-auto font-mono text-xs text-muted-foreground tabular-nums" role="status">
            {(start + 1).toLocaleString()}–{end.toLocaleString()} of {changes.length.toLocaleString()}
          </span>
          <Button ref={prevRef} variant="outline" size="xs" disabled={page === 0} onClick={goPrev}>
            Previous
          </Button>
          <Button ref={nextRef} variant="outline" size="xs" disabled={end === changes.length} onClick={goNext}>
            Next
          </Button>
        </nav>
      )}
    </>
  );
}

export function SavedWorkbookResult({
  report,
  onBack,
  onOpenHistory,
}: {
  report: WorkbookReport;
  onBack: () => void;
  onOpenHistory?: () => void;
}) {
  const [index, setIndex] = useState(() => Math.max(0, report.sheets.findIndex((sheet) => !sheet.identical)));
  const heading = useRef<HTMLHeadingElement>(null);
  const sheet = report.sheets[index];
  const changes = report.changes?.[index];
  const totalChangesInSheet = report.truncated?.[index];
  const total = countSummary(report.totals);

  useEffect(() => {
    const frame = requestAnimationFrame(() => heading.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <section
      className="workbench-scroll flex min-w-0 flex-col gap-3 min-[901px]:min-h-0 min-[901px]:overflow-auto"
      aria-label="Saved workbook result"
    >
      <div className={`${panel} space-y-3.5 p-4`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Saved workbook report</p>
            <h1
              ref={heading}
              tabIndex={-1}
              className={`mt-0.5 text-lg font-semibold tracking-tight focus:outline-none ${report.identical ? "text-add" : "text-foreground"}`}
            >
              {report.identical ? "No differences found" : "Differences found"}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {onOpenHistory && (
              <Button variant="ghost" size="sm" aria-haspopup="dialog" onClick={onOpenHistory}>
                <HistoryIcon aria-hidden /> Saved
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={onBack}>
              <ArrowLeftIcon aria-hidden /> Back
            </Button>
          </div>
        </div>
        <dl className="grid grid-cols-1 gap-x-5 gap-y-2 rounded-md border border-border/70 bg-surface-subtle/50 p-3 text-xs sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-muted-foreground">Original</dt>
            <dd className="mt-0.5 font-mono font-medium text-foreground wrap-anywhere">{report.originalName}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground">Modified</dt>
            <dd className="mt-0.5 font-mono font-medium text-foreground wrap-anywhere">{report.modifiedName}</dd>
          </div>
        </dl>
        {total && <p className="text-xs text-muted-foreground tabular-nums">{total}</p>}
        <div className="border-t border-border pt-3">
          <SavedSettings options={report.options} />
        </div>
      </div>

      {report.identical ? (
        <MatchedState summary={report} showVerdict={false} />
      ) : (
        <div className={`${panel} flex flex-col gap-3 p-4`}>
          {report.sheetOrderChanged && <p className={infoBanner}>The matching sheets appear in a different order.</p>}
          {sheet && (
            <>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="w-full max-w-md">
                  <label htmlFor="saved-sheet-select" className="mb-1.5 block text-xs font-medium text-foreground">
                    Sheet
                  </label>
                  <NativeSelect
                    id="saved-sheet-select"
                    aria-label="Sheet in saved result"
                    value={index}
                    onChange={(event) => setIndex(Number(event.currentTarget.value))}
                  >
                    {report.sheets.map((entry, position) => (
                      <NativeSelectOption key={position} value={position}>
                        {title(entry)} · {sheetOption(entry)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
                <p className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground tabular-nums">
                  {sheet.status !== "matched" && (
                    <Badge tone={sheet.status === "added" ? "add" : sheet.status === "removed" ? "rem" : "chg"}>{sheet.status}</Badge>
                  )}
                  {sheet.originalSize && (
                    <span>
                      Orig {sheet.originalSize[0].toLocaleString()}×{sheet.originalSize[1].toLocaleString()}
                    </span>
                  )}
                  {sheet.modifiedSize && (
                    <span>
                      Mod {sheet.modifiedSize[0].toLocaleString()}×{sheet.modifiedSize[1].toLocaleString()}
                    </span>
                  )}
                  <span>{plural(sheet.comparedRows, "row")} compared</span>
                </p>
              </div>
              {sheet.mergesAdded && <p className="text-xs text-add wrap-anywhere">Merges added: {sheet.mergesAdded.join(", ")}</p>}
              {sheet.mergesRemoved && <p className="text-xs text-remove wrap-anywhere">Merges removed: {sheet.mergesRemoved.join(", ")}</p>}
              {totalChangesInSheet !== undefined && totalChangesInSheet > 0 && changes && (
                <p className={warningBanner}>
                  Showing the first {changes.length.toLocaleString()} of {totalChangesInSheet.toLocaleString()} changes in this sheet. Save with source workbooks to inspect every row.
                </p>
              )}
              {changes?.length ? (
                <ChangeList key={index} changes={changes} />
              ) : (
                <p className="py-4 text-xs text-muted-foreground">No row or cell changes in this sheet.</p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

import { Badge } from "@/components/ui/badge";
import { panel, infoBanner } from "./styles";
import type { WorkbookReportSummary } from "../core/workbookReport";
import { Icon } from "./Icon";
import { plural } from "./summary";

export function MatchedState({ summary, showVerdict = true }: { summary: WorkbookReportSummary; showVerdict?: boolean }) {
  const { options } = summary;
  const relaxed = [
    options.ignoreCase && "case ignored",
    options.trimWhitespace && "whitespace trimmed",
    options.ignoreEmpty && "empty cells ignored",
    options.compareMode === "formulas" && "formulas compared",
  ].filter(Boolean) as string[];

  return (
    <section className={`${panel} workbench-scroll flex min-h-0 flex-col gap-4 overflow-auto p-5 wrap-anywhere`} aria-live="polite">
      {showVerdict && (
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-add/25 bg-add-tint text-add" aria-hidden>
            <Icon name="check" size={18} />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-foreground">No differences found</h2>
            <p className="mt-0.5 text-sm text-pretty text-muted-foreground">
              <span className="font-mono text-xs text-foreground">{summary.originalName}</span> and{" "}
              <span className="font-mono text-xs text-foreground">{summary.modifiedName}</span> have matching sheets and cell contents.
            </p>
            {relaxed.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {relaxed.map((rule) => (
                  <Badge key={rule} tone="neutral">
                    {rule}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {summary.sheetOrderChanged && <p className={infoBanner}>The sheets appear in a different order. Their contents match.</p>}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-border bg-surface-subtle">
            <tr className="[&_th]:px-3 [&_th]:py-2 [&_th]:font-medium [&_th]:text-balance [&_th]:text-muted-foreground">
              <th>Sheet</th>
              <th>Dimensions</th>
              <th>Rows compared</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/80">
            {summary.sheets.map((s) => {
              const [rows, columns] = s.originalSize ?? [0, 0];
              return (
                <tr key={s.modifiedName} className="hover:bg-surface-subtle/40 [&_td]:px-3 [&_td]:py-2">
                  <td className="font-mono font-medium text-foreground">{s.modifiedName}</td>
                  <td className="font-mono text-muted-foreground tabular-nums">
                    {plural(rows, "row")} × {plural(Math.max(columns, s.modifiedSize?.[1] ?? 0), "col")}
                  </td>
                  <td className="font-mono text-muted-foreground tabular-nums">
                    {s.comparedRows.toLocaleString()} / {s.comparedRows.toLocaleString()}
                  </td>
                  <td className="font-medium text-add">✓ Identical</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

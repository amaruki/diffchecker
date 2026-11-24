import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { resultLayout, summaryFrame, summaryRow, divider, paneLayout, panel, warningBanner, infoBanner, kbdKey } from "../styles";
import { ChevronDownIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ROW_STATUS } from "../../core/pack";
import type { PackedTextDiff } from "../../text/pack";
import type { JsonChange } from "../../text/types";
import { changeStarts, lineToRow, rowToVisible, visibleLines } from "../../text/view";
import { ChangeRuler } from "../ChangeRuler";
import { DiffNav } from "../DiffNav";
import { upperBound, useDiffNavigation } from "../navigation";
import { useScrollSync } from "../scrollSync";
import { plural } from "../summary";
import { KeyHint, Stat } from "../SummaryBar";
import { LINE_H, MAX_RENDER_CHARS, TextPane } from "./TextPane";

interface TextDiffViewProps {
  diff: PackedTextDiff;
  diffMs: number;
  onlyChanges: boolean;
  originalName: string;
  modifiedName: string;
  /** True while a newer comparison is running; the view is dimmed. */
  stale: boolean;
  keysEnabled: boolean;
}

const SAME = ROW_STATUS.indexOf("same");

/** Rendered rows of the JSON change list; the rest are reachable with n / p. */
const CHANGE_LIST_LIMIT = 300;

const KIND_LABEL: Record<JsonChange["kind"], string> = {
  added: "added",
  removed: "removed",
  changed: "changed",
  type: "type",
};

export function TextDiffView({ diff, diffMs, onlyChanges, originalName, modifiedName, stale, keysEnabled }: TextDiffViewProps) {
  const [selectedK, setSelectedK] = useState(-1);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const { onLeftScroll, onRightScroll } = useScrollSync(leftRef, rightRef);

  useEffect(() => setSelectedK(-1), [diff]);

  const visible = useMemo(() => visibleLines(diff.rows.status, onlyChanges), [diff, onlyChanges]);
  const starts = useMemo(() => changeStarts(visible, diff.rows.status), [visible, diff]);
  const kToV = useMemo(() => rowToVisible(visible, diff.rows.length), [visible, diff]);
  /** Ruler marks: status per visible entry; collapsed gaps draw nothing. */
  const codes = useMemo(() => Uint8Array.from(visible, (k) => (k >= 0 ? diff.rows.status[k]! : SAME)), [visible, diff]);
  const currentPos = selectedK >= 0 && selectedK < kToV.length ? kToV[selectedK]! : -1;
  const visibleSelectedK = currentPos >= 0 ? selectedK : -1;

  const reveal = useCallback((v: number) => {
    const el = leftRef.current;
    if (!el) return;
    const top = v * LINE_H;
    if (top < el.scrollTop || top + LINE_H > el.scrollTop + el.clientHeight) el.scrollTop = Math.max(0, top - el.clientHeight / 3);
  }, []);

  const goTo = useCallback(
    (v: number) => {
      const k = visible[v];
      if (k === undefined || k < 0) return;
      setSelectedK(k);
      reveal(v);
    },
    [visible, reveal],
  );

  const { next, prev } = useDiffNavigation(starts, currentPos, goTo, keysEnabled);
  /** Change block that contains the selection (not only its first line). */
  const block = currentPos >= 0 && visibleSelectedK >= 0 && diff.rows.status[visibleSelectedK] !== SAME ? upperBound(starts, currentPos) - 1 : -1;

  const linesToRowL = useMemo(() => lineToRow(diff.rows.orig, diff.left.count), [diff]);
  const linesToRowR = useMemo(() => lineToRow(diff.rows.mod, diff.right.count), [diff]);
  const jumpToChange = (c: JsonChange) => {
    const k = c.modLine >= 0 ? linesToRowR[c.modLine]! : c.origLine >= 0 ? linesToRowL[c.origLine]! : -1;
    if (k >= 0 && k < kToV.length && kToV[k]! >= 0) goTo(kToV[k]!);
  };

  const widthChars = Math.min(Math.max(diff.left.maxLength, diff.right.maxLength), MAX_RENDER_CHARS + 60);
  const c = diff.counts;
  const json = diff.json;

  return (
    <section className={`${resultLayout} data-[stale=true]:opacity-75`} data-stale={stale}>
      {diff.notes.map((n, i) => (
        <p key={i} className={n.level === "warning" ? warningBanner : infoBanner}>
          {n.message}
        </p>
      ))}

      <div className={summaryFrame}>
        <div className={summaryRow}>
          <DiffNav onPrev={prev} onNext={next} total={starts.length} current={block} noun="Change" emptyText="No changes" />
          <span className={divider} />
          <span className="font-medium text-foreground tabular-nums">{plural(starts.length, "changed block")}</span>
          <Stat kind="add" sign="+" value={c.added} unit="line" />
          <Stat kind="rem" sign="−" value={c.removed} unit="line" />
          <Stat kind="chg" sign="~" value={c.changed} unit="line" />
          <span className="text-muted-foreground tabular-nums">{c.unchanged.toLocaleString()} unchanged</span>
          {json && (
            <>
              <span className={divider} />
              <span className="text-muted-foreground tabular-nums">{plural(json.total, "JSON change")}</span>
            </>
          )}
          <div className="ml-auto flex items-center gap-3">
            <KeyHint />
            <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{Math.round(diffMs)} ms</span>
          </div>
        </div>
      </div>

      <p id="line-navigation" className="sr-only">
        Use the up and down arrow keys, Home, and End to move between lines.
      </p>

      <div className={resultLayout}>
        <div className={paneLayout}>
          {(["orig", "mod"] as const).map((side) => (
            <TextPane
              key={side}
              side={side}
              sideText={side === "orig" ? "Original" : "Modified"}
              fileName={side === "orig" ? originalName : modifiedName}
              lines={side === "orig" ? diff.left : diff.right}
              rows={diff.rows}
              highlights={side === "orig" ? diff.hlOrig : diff.hlMod}
              visible={visible}
              kToV={kToV}
              widthChars={widthChars}
              selectedK={visibleSelectedK}
              onSelect={setSelectedK}
              scrollRef={side === "orig" ? leftRef : rightRef}
              onScroll={side === "orig" ? onLeftScroll : onRightScroll}
            />
          ))}
          <ChangeRuler codes={codes} scrollRef={leftRef} rowHeight={LINE_H} />
        </div>

        {json && json.total > 0 && (
          <aside className={`${panel} workbench-scroll max-h-[clamp(8rem,26vh,14rem)] shrink-0 overflow-auto`} aria-label="Structural changes">
            <Collapsible defaultOpen>
              <h3 className="sticky top-0 z-2 border-b border-border bg-surface-subtle">
                <CollapsibleTrigger
                  render={<Button variant="ghost" size="sm" />}
                  className="group/changes w-full justify-start rounded-none text-xs font-medium text-foreground hover:bg-muted/70 focus-visible:-outline-offset-2"
                >
                  <ChevronDownIcon className="text-muted-foreground motion-safe:transition-transform group-data-panel-open/changes:rotate-180" aria-hidden />
                  <span>Structural changes</span>
                  <Badge tone="neutral">{json.total.toLocaleString()}</Badge>
                </CollapsibleTrigger>
              </h3>
              <CollapsibleContent>
                <ol className="divide-y divide-border/70">
                  {json.changes.slice(0, CHANGE_LIST_LIMIT).map((ch, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        onClick={() => jumpToChange(ch)}
                        className="flex w-full flex-wrap items-baseline gap-x-2.5 gap-y-1 px-3 py-1.5 text-left text-xs motion-safe:transition-colors hover:bg-surface-subtle/80 focus-visible:bg-surface-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                      >
                        <Badge tone={ch.kind === "added" ? "add" : ch.kind === "removed" ? "rem" : "chg"} className="min-w-[3.75rem] justify-center">
                          {KIND_LABEL[ch.kind]}
                        </Badge>
                        <code className="min-w-0 font-mono font-medium text-foreground wrap-anywhere">
                          {ch.origPath && ch.modPath && ch.origPath !== ch.modPath ? `${ch.origPath} → ${ch.modPath}` : (ch.modPath ?? ch.origPath)}
                        </code>
                        <span className="flex min-w-0 flex-wrap items-baseline gap-1.5 font-mono text-[11.5px]">
                          {ch.oldValue !== undefined && (
                            <code className="max-w-72 truncate rounded-[3px] bg-remove-tint px-1 py-0.5 text-remove">{ch.oldValue}</code>
                          )}
                          {ch.oldValue !== undefined && ch.newValue !== undefined && (
                            <span className="font-sans text-muted-foreground" aria-hidden>
                              →
                            </span>
                          )}
                          {ch.newValue !== undefined && (
                            <code className="max-w-72 truncate rounded-[3px] bg-add-tint px-1 py-0.5 text-add">{ch.newValue}</code>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
                {json.total > Math.min(json.changes.length, CHANGE_LIST_LIMIT) && (
                  <p className="border-t border-border bg-surface-subtle/50 px-3 py-2 text-xs text-muted-foreground">
                    Showing {Math.min(json.changes.length, CHANGE_LIST_LIMIT).toLocaleString()} of {json.total.toLocaleString()}. Use{" "}
                    <kbd className={kbdKey}>n</kbd> / <kbd className={kbdKey}>p</kbd> to step through all changes.
                  </p>
                )}
              </CollapsibleContent>
            </Collapsible>
          </aside>
        )}
      </div>
    </section>
  );
}

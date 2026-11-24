import { Button } from "@/components/ui/button";
import {
  modeLayout,
  intakeLayout,
  inputsLayout,
  introHeading,
  introDescription,
  introLayout,
  intakeNote,
  errorBanner,
  infoBanner,
  resultLayout,
  resultPlaceholder,
  spinner,
  panel,
} from "./ui/styles";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { DEFAULT_OPTIONS, type DiffOptions } from "./core/types";
import { MAX_WORKBOOK_BYTES } from "./core/parse";
import { captureWorkbookReport, summarizeWorkbook, type WorkbookReport } from "./core/workbookReport";
import { canSwap, INITIAL_STATE, reducer, type SlotState } from "./state/machine";
import type { ComparisonSnapshot } from "./state/savedComparisons";
import { DiffView } from "./ui/DiffView";
import { DropOverlay } from "./ui/DropOverlay";
import { Icon } from "./ui/Icon";
import { FileDrop } from "./ui/FileDrop";
import { MatchedState } from "./ui/MatchedState";
import { OptionsBar } from "./ui/OptionsBar";
import { useSavedComparisons } from "./ui/SavedComparisons";
import { SavedWorkbookResult } from "./ui/SavedWorkbookResult";
import { spreadsheetSample } from "./ui/samples";
import { DiffWorkerClient } from "./worker/client";
import type { Side, WorkerResponse } from "./worker/protocol";

const ACCEPTED_EXTENSION = /\.(xlsx|xlsm)$/i;

const slotName = (slot: SlotState): string | null => (slot.status === "empty" ? null : slot.fileName);

/** The .xlsx comparison mode. Stays mounted while hidden so loaded files survive a mode switch. */
export function SpreadsheetMode({ active }: { active: boolean }) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const [client, setClient] = useState<DiffWorkerClient | null>(null);
  const [workerGeneration, setWorkerGeneration] = useState(0);
  const [workerError, setWorkerError] = useState<string | null>(null);
  const [slowRun, setSlowRun] = useState(false);
  const [options, setOptions] = useState<DiffOptions>(DEFAULT_OPTIONS);
  const [requestedOptions, setRequestedOptions] = useState<DiffOptions | null>(null);
  const [onlyDiffs, setOnlyDiffs] = useState(false);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const [savedResult, setSavedResult] = useState<{ key: string; report: WorkbookReport } | null>(null);
  const [loadedFromHistory, setLoadedFromHistory] = useState(false);
  const newPairInput = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const readVersion = useRef<Record<Side, number>>({ original: 0, modified: 0 });
  const pendingReloadRef = useRef<Array<[Side, File]> | null>(null);

  useEffect(() => {
    const onResponse = (msg: WorkerResponse): void => {
      switch (msg.type) {
        case "loaded":
          dispatch({ type: "PARSE_SUCCEEDED", side: msg.side, requestId: msg.id, workbook: msg.workbook, parseMs: msg.parseMs });
          break;
        case "load-error":
          dispatch({ type: "PARSE_FAILED", side: msg.side, requestId: msg.id, error: msg.message });
          break;
        case "diffed":
          dispatch({ type: "DIFF_SUCCEEDED", requestId: msg.id, diff: msg.diff, diffMs: msg.diffMs });
          break;
        case "diff-error":
          dispatch({ type: "DIFF_FAILED", requestId: msg.id, error: msg.message });
          break;
      }
    };
    const onCrash = (message: string): void => {
      setWorkerError(message);
      dispatch({ type: "WORKER_CRASHED", error: message });
    };
    const c = new DiffWorkerClient(onResponse, onCrash);
    setClient(c);
    return () => c.terminate();
  }, [workerGeneration]);

  const origWb = state.original.status === "ready" ? state.original.workbook : null;
  const modWb = state.modified.status === "ready" ? state.modified.workbook : null;
  /** Changes when either workbook changes, not when only options do: a new pair opens on its first difference. */
  const pairKey = useMemo(() => ({}), [origWb, modWb]);

  useEffect(() => {
    if (!client || workerError || !origWb || !modWb) return;
    setRequestedOptions(options);
    dispatch({ type: "DIFF_STARTED", requestId: client.diff(options) });
  }, [client, workerError, origWb, modWb, options]);

  const isBusy =
    !workerError && (state.comparison.status === "running" || state.original.status === "parsing" || state.modified.status === "parsing");
  useEffect(() => {
    if (!isBusy) {
      setSlowRun(false);
      return;
    }
    const timer = setTimeout(() => setSlowRun(true), 1500);
    return () => clearTimeout(timer);
  }, [isBusy]);

  /**
   * Read every file first, then mark all sides as parsing in the same tick. Marking one side
   * before the other file is read would let a fast parse compare the new Original with the old Modified.
   */
  const loadFiles = useCallback(
    async (entries: Array<[Side, File]>, restored?: { options: DiffOptions; onlyDiffs: boolean }) => {
      if (!client || workerError) return;
      setSavedResult(null);
      const read = await Promise.all(
        entries.map(async ([side, file]) => {
          const version = ++readVersion.current[side];
          const entry = { side, name: file.name, version };
          if (!ACCEPTED_EXTENSION.test(file.name)) return { ...entry, error: "Choose an .xlsx or .xlsm file." };
          if (file.size > MAX_WORKBOOK_BYTES) {
            return {
              ...entry,
              error: `The file is ${(file.size / 1024 / 1024).toFixed(0)} MB. The limit is ${MAX_WORKBOOK_BYTES / 1024 / 1024} MB.`,
            };
          }
          try {
            const buffer = await file.arrayBuffer();
            return { ...entry, buffer, source: file };
          } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            return { ...entry, error: `The browser could not read the file (${detail}).` };
          }
        }),
      );
      const current = read.filter(({ side, version }) => readVersion.current[side] === version);
      if (current.length === 0) return;
      if (restored) {
        if (current.length !== read.length) return;
        setOptions(restored.options);
        setOnlyDiffs(restored.onlyDiffs);
      }
      setLoadedFromHistory(!!restored);
      for (const entry of current) {
        const { side, name } = entry;
        if ("buffer" in entry) {
          dispatch({ type: "FILE_SELECTED", side, fileName: name, requestId: client.load(side, name, entry.buffer), source: entry.source });
        } else {
          client.clear(side);
          dispatch({ type: "FILE_REJECTED", side, fileName: name, error: entry.error });
        }
      }
    },
    [client, workerError],
  );

  /** Dropping or choosing two files at once fills both slots in order. */
  const onFiles = useCallback(
    (side: Side, files: File[]) => {
      const [first, second] = files;
      if (first && second) {
        void loadFiles([
          ["original", first],
          ["modified", second],
        ]);
      } else if (first) {
        void loadFiles([[side, first]]);
      }
    },
    [loadFiles],
  );

  const onClear = (side: Side) => {
    readVersion.current[side]++;
    setLoadedFromHistory(false);
    if (!workerError) client?.clear(side);
    dispatch({ type: "FILE_CLEARED", side });
  };

  /** Respawn the worker to recover from a crash or cancel a hung parse/diff. */
  const restartEngine = useCallback(
    (reloadReadySources: boolean) => {
      const toReload: Array<[Side, File]> = [];
      if (reloadReadySources) {
        if ((state.original.status === "ready" || state.original.status === "parsing") && state.original.source) {
          toReload.push(["original", state.original.source]);
        }
        if ((state.modified.status === "ready" || state.modified.status === "parsing") && state.modified.source) {
          toReload.push(["modified", state.modified.source]);
        }
      }
      readVersion.current.original++;
      readVersion.current.modified++;
      if (state.original.status !== "empty") dispatch({ type: "FILE_CLEARED", side: "original" });
      if (state.modified.status !== "empty") dispatch({ type: "FILE_CLEARED", side: "modified" });
      pendingReloadRef.current = toReload.length > 0 ? toReload : null;
      setWorkerError(null);
      setSlowRun(false);
      setWorkerGeneration((g) => g + 1);
    },
    [state.original, state.modified],
  );

  useEffect(() => {
    if (!client || workerError || !pendingReloadRef.current) return;
    const entries = pendingReloadRef.current;
    pendingReloadRef.current = null;
    void loadFiles(entries);
  }, [client, workerError, loadFiles]);

  /** "New comparison…": two files replace both sides; one file starts a new pair as Original. */
  const startNewPair = (files: File[]) => {
    if (files.length === 0) return;
    if (files.length === 1) onClear("modified");
    onFiles("original", files);
  };

  const swap = () => {
    if (!client || workerError || !canSwap(state)) return;
    // Invalidate any in-flight file reads so a slow read cannot overwrite the swapped slot.
    readVersion.current.original++;
    readVersion.current.modified++;
    client.swap();
    dispatch({ type: "SWAPPED" });
  };

  const loadSample = async () => {
    if (workerError) return;
    setSampleError(null);
    const originalVersion = ++readVersion.current.original;
    const modifiedVersion = ++readVersion.current.modified;
    try {
      const pair = await spreadsheetSample();
      if (originalVersion !== readVersion.current.original || modifiedVersion !== readVersion.current.modified) return;
      onFiles("original", [pair.original, pair.modified]);
    } catch (err) {
      if (originalVersion !== readVersion.current.original || modifiedVersion !== readVersion.current.modified) return;
      setSampleError(err instanceof Error ? err.message : String(err));
    }
  };

  const cmp = state.comparison;
  const shown = cmp.status === "done" ? cmp : cmp.status === "running" ? cmp.previous : null;
  /** Nothing loaded yet: the drop zones fill the page and the options wait. */
  const intake = !savedResult && state.original.status === "empty" && state.modified.status === "empty";
  const originalSource = state.original.status === "ready" ? state.original.source : undefined;
  const modifiedSource = state.modified.status === "ready" ? state.modified.source : undefined;
  const captureSources =
    !savedResult && originalSource && modifiedSource
      ? (): ComparisonSnapshot => ({
          mode: "sheet",
          original: originalSource,
          modified: modifiedSource,
          options,
          onlyDiffs,
        })
      : undefined;
  const captureResult =
    !savedResult && cmp.status === "done" && options === requestedOptions && origWb && modWb
      ? (): ComparisonSnapshot => ({ mode: "sheet", report: captureWorkbookReport(cmp.diff, origWb, modWb, options) })
      : undefined;

  const openSaved = (snapshot: ComparisonSnapshot, key: string) => {
    if (snapshot.mode !== "sheet") return;
    if ("report" in snapshot) {
      setSavedResult({ key, report: snapshot.report });
      return;
    }
    setSavedResult(null);
    return loadFiles(
      [
        ["original", snapshot.original],
        ["modified", snapshot.modified],
      ],
      snapshot,
    );
  };

  const saved = useSavedComparisons({
    mode: "sheet",
    active,
    canOpen: !!client && !workerError,
    capture: captureResult,
    captureSources,
    saveLabel: loadedFromHistory ? "Save compact copy" : "Save result",
    onOpen: openSaved,
    onDeleted: (key) => setSavedResult((cur) => (cur?.key === key ? null : cur)),
  });

  return (
    <div className={intake ? `${modeLayout} ${intakeLayout}` : modeLayout} hidden={!active}>
      <DropOverlay
        enabled={active && !saved.isOpen && !workerError}
        names={{ original: slotName(state.original), modified: slotName(state.modified) }}
        onFiles={onFiles}
      />

      {!savedResult && (
        <>
          {intake ? (
            <>
              <div className={introLayout}>
                <div>
                  <h1 ref={headingRef} tabIndex={-1} className={`${introHeading} focus:outline-none`}>
                    Compare spreadsheets
                  </h1>
                  <p className={introDescription}>
                    Inspect cell values, formulas, inserted rows, and sheet changes side by side. Runs entirely in your browser.
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {saved.historyButton}
                  <Button variant="outline" size="sm" disabled={!!workerError} onClick={() => void loadSample()}>
                    Try sample workbooks
                    <Icon name="arrow" size={14} />
                  </Button>
                </div>
              </div>

              <section className={inputsLayout} aria-label="Workbooks">
                <FileDrop variant="intake" label="Original" side="original" slot={state.original} onFiles={onFiles} onClear={onClear} />
                <FileDrop variant="intake" label="Modified" side="modified" slot={state.modified} onFiles={onFiles} onClear={onClear} />
              </section>

              <div className={intakeNote}>
                <p id="workbook-pair-order">
                  Have both files ready? Select or drop two files at once — the first loads as Original, the second as Modified.
                </p>
                <Button variant="outline" size="xs" disabled={!!workerError} aria-describedby="workbook-pair-order" onClick={() => newPairInput.current?.click()}>
                  Choose both files…
                </Button>
                {sampleError && (
                  <p className="basis-full text-remove" role="alert">
                    {sampleError}
                  </p>
                )}
              </div>
            </>
          ) : (
            <>
              <h1 ref={headingRef} tabIndex={-1} className="sr-only">
                Spreadsheet comparison
              </h1>

              <section
                className={`${panel} grid grid-cols-1 divide-y divide-border min-[721px]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] min-[721px]:divide-x min-[721px]:divide-y-0`}
                aria-label="Workbooks"
              >
                <FileDrop variant="strip" label="Original" side="original" slot={state.original} onFiles={onFiles} onClear={onClear} />
                <div className="hidden items-center justify-center bg-surface-subtle/50 px-1 min-[721px]:flex">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={swap}
                    disabled={!!workerError || !canSwap(state)}
                    aria-label="Swap Original and Modified"
                    title="Swap Original and Modified"
                  >
                    <Icon name="swap" size={14} />
                  </Button>
                </div>
                <FileDrop variant="strip" label="Modified" side="modified" slot={state.modified} onFiles={onFiles} onClear={onClear} />
              </section>

              <OptionsBar
                options={options}
                onChange={setOptions}
                showFilter={!!origWb && !!modWb}
                onlyDiffs={onlyDiffs}
                onOnlyDiffsChange={setOnlyDiffs}
                subrow={saved.toolbarSubrow}
                actions={
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="min-[721px]:hidden"
                      onClick={swap}
                      disabled={!!workerError || !canSwap(state)}
                      title="Swap Original and Modified"
                    >
                      <Icon name="swap" size={14} /> Swap
                    </Button>
                    {saved.saveActions}
                    {saved.historyButton}
                    <Button size="sm" disabled={!!workerError} onClick={() => newPairInput.current?.click()} title="Choose the next two workbooks in one dialog">
                      New comparison…
                    </Button>
                  </>
                }
              />
            </>
          )}
        </>
      )}

      {saved.dialogElement}

      {savedResult ? (
        <SavedWorkbookResult
          key={savedResult.key}
          report={savedResult.report}
          onBack={() => {
            setSavedResult(null);
            requestAnimationFrame(() => headingRef.current?.focus());
          }}
          onOpenHistory={saved.openHistory}
        />
      ) : (
        <>
          <input
            ref={newPairInput}
            type="file"
            accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            multiple
            hidden
            onChange={(e) => {
              const files = Array.from(e.currentTarget.files ?? []);
              e.currentTarget.value = "";
              startNewPair(files);
            }}
          />

          {workerError && (
            <div className={`${errorBanner} items-center justify-between gap-3`} role="alert">
              <span>The comparison engine stopped: {workerError}</span>
              <Button variant="outline" size="xs" onClick={() => restartEngine(true)}>
                Restart engine
              </Button>
            </div>
          )}

          {cmp.status === "running" && shown && slowRun && (
            <div className={`${infoBanner} items-center justify-between gap-3`} role="status">
              <span className="inline-flex items-center gap-2">
                <span className={spinner} /> Updating comparison…
              </span>
              <Button variant="outline" size="xs" onClick={() => restartEngine(false)}>
                Cancel
              </Button>
            </div>
          )}

          <section className={resultLayout} aria-label="Spreadsheet results" hidden={intake}>
            {!workerError && cmp.status === "idle" && (
              <IdleMessage original={state.original} modified={state.modified} onCancel={slowRun ? () => restartEngine(false) : undefined} />
            )}
            {cmp.status === "running" && !shown && (
              <div className={resultPlaceholder} aria-live="polite">
                <span className="inline-flex items-center gap-2">
                  <span className={spinner} /> Comparing workbooks…
                </span>
                {slowRun && (
                  <Button variant="outline" size="xs" onClick={() => restartEngine(false)}>
                    Cancel comparison
                  </Button>
                )}
              </div>
            )}
            {cmp.status === "failed" && !workerError && (
              <div className={errorBanner} role="alert">
                {cmp.error}
              </div>
            )}
            {shown &&
              origWb &&
              modWb &&
              (shown.diff.identical ? (
                <MatchedState summary={summarizeWorkbook(shown.diff, origWb, modWb, options)} />
              ) : (
                <DiffView
                  key={pairKeyId(pairKey)}
                  diff={shown.diff}
                  original={origWb}
                  modified={modWb}
                  options={options}
                  onlyDiffs={onlyDiffs}
                  diffMs={shown.diffMs}
                  stale={cmp.status === "running"}
                  keysEnabled={active && !saved.isOpen}
                />
              ))}
          </section>
        </>
      )}
    </div>
  );
}

/** Stable small id per pair object, for use as a React key. */
const pairIds = new WeakMap<object, number>();
let nextPairId = 1;
function pairKeyId(pair: object): number {
  let id = pairIds.get(pair);
  if (id === undefined) pairIds.set(pair, (id = nextPairId++));
  return id;
}

/** What the comparison waits for: files being read, or the missing side. */
function IdleMessage({ original, modified, onCancel }: { original: SlotState; modified: SlotState; onCancel?: () => void }) {
  const reading = [original, modified].flatMap((s) => (s.status === "parsing" ? [s.fileName] : []));
  if (reading.length > 0) {
    return (
      <div className={resultPlaceholder} aria-live="polite">
        <span className="inline-flex items-center gap-2">
          <span className={spinner} /> Reading <strong className="font-mono text-foreground">{reading.join(" and ")}</strong>…
        </span>
        {onCancel && (
          <Button variant="outline" size="xs" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    );
  }
  if (original.status === "failed" || modified.status === "failed") {
    return <p className={resultPlaceholder}>Replace the workbook with the error to continue.</p>;
  }
  if (original.status === "ready" && modified.status === "ready") {
    return (
      <p className={resultPlaceholder} aria-live="polite">
        <span className="inline-flex items-center gap-2">
          <span className={spinner} /> Comparing workbooks…
        </span>
      </p>
    );
  }
  const missing = original.status === "empty" ? "Original" : "Modified";
  return <p className={resultPlaceholder}>Add the {missing.toLowerCase()} workbook to start the comparison.</p>;
}

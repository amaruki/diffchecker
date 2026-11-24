import { FieldGroup } from "@/components/ui/field";
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
  resultLayout,
  resultPlaceholder,
  spinner,
  panel,
  warningBanner,
  infoBanner,
} from "../styles";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { INITIAL_TEXT_STATE, isComparable, textReducer, type TextSlot } from "../../state/textMachine";
import type { ComparisonSnapshot } from "../../state/savedComparisons";
import { readTextFile, TextDecodeError } from "../../text/decode";
import { DEFAULT_TEXT_OPTIONS, type TextDiffOptions, type TextInput } from "../../text/types";
import type { Side } from "../../worker/protocol";
import { TextWorkerClient } from "../../worker/textClient";
import { textSample, type TextSampleKind } from "../samples";
import { plural } from "../summary";
import { TextDiffView } from "./TextDiffView";
import { TextInputPanel, type TextPanelVariant } from "./TextInputPanel";
import { TextOptionsBar } from "./TextOptionsBar";
import { Icon } from "../Icon";
import { DropOverlay } from "../DropOverlay";
import { useSavedComparisons } from "../SavedComparisons";

/** Wait after the last keystroke before comparing again. */
const DEBOUNCE_MS = 250;

function toInput(slot: TextSlot): TextInput {
  return slot.status === "ready" ? { name: slot.fileName, text: slot.text } : { name: null, text: "" };
}

function slotName(slot: TextSlot): string | null {
  return slot.status === "empty" ? null : (slot.fileName ?? "pasted text");
}

function displayName(slot: TextSlot): string {
  if (slot.status === "ready") return slot.fileName ?? "pasted text";
  return slot.status === "empty" ? "(empty)" : slot.fileName;
}

/** The text / JSON comparison mode. Stays mounted while hidden so its inputs survive a mode switch. */
export function TextMode({ active }: { active: boolean }) {
  const [state, dispatch] = useReducer(textReducer, INITIAL_TEXT_STATE);
  const [client, setClient] = useState<TextWorkerClient | null>(null);
  const [workerGeneration, setWorkerGeneration] = useState(0);
  const [workerError, setWorkerError] = useState<string | null>(null);
  const [slowRun, setSlowRun] = useState(false);
  const [pendingDebounce, setPendingDebounce] = useState(false);
  const [renderedNames, setRenderedNames] = useState<{ original: string; modified: string } | null>(null);
  const [options, setOptions] = useState<TextDiffOptions>(DEFAULT_TEXT_OPTIONS);
  const [onlyChanges, setOnlyChanges] = useState(false);
  const readId = useRef(0);
  const requestNamesRef = useRef<Map<number, { original: string; modified: string }>>(new Map());
  /** Editors open while a result is shown. View state only; the comparison does not depend on it. */
  const [editing, setEditing] = useState(true);
  /** How the inputs last changed. Typing keeps the editors open; a paste or a file load folds them. */
  const lastInput = useRef<"paste" | "type" | "file">("type");
  const originalRef = useRef<HTMLTextAreaElement>(null);
  const modifiedRef = useRef<HTMLTextAreaElement>(null);
  const resultsRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onCrash = (message: string) => {
      setWorkerError(message);
      dispatch({ type: "WORKER_CRASHED", error: message });
    };
    const c = new TextWorkerClient((msg) => {
      if (msg.type === "diffed") {
        const names = requestNamesRef.current.get(msg.id);
        requestNamesRef.current.delete(msg.id);
        if (names) setRenderedNames(names);
        dispatch({ type: "DIFF_SUCCEEDED", requestId: msg.id, diff: msg.diff, diffMs: msg.diffMs });
      } else {
        requestNamesRef.current.delete(msg.id);
        dispatch({ type: "DIFF_FAILED", requestId: msg.id, error: msg.message });
      }
    }, onCrash);
    setClient(c);
    return () => {
      requestNamesRef.current.clear();
      c.terminate();
    };
  }, [workerGeneration]);

  useEffect(() => {
    if (!client || workerError || !isComparable(state)) {
      setPendingDebounce(false);
      return;
    }
    setPendingDebounce(true);
    const origName = displayName(state.original);
    const modName = displayName(state.modified);
    const timer = setTimeout(() => {
      setPendingDebounce(false);
      const id = client.diff(toInput(state.original), toInput(state.modified), options);
      requestNamesRef.current.set(id, { original: origName, modified: modName });
      dispatch({ type: "DIFF_STARTED", requestId: id });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `state.comparison` is deliberately not a dependency: a finished diff must not trigger another.
  }, [client, workerError, state.original, state.modified, options]);

  useEffect(() => {
    if (workerError || state.comparison.status !== "running") {
      setSlowRun(false);
      return;
    }
    const timer = setTimeout(() => setSlowRun(true), 1500);
    return () => clearTimeout(timer);
  }, [workerError, state.comparison.status]);

  const restartEngine = useCallback((clearInputs: boolean) => {
    setWorkerError(null);
    setSlowRun(false);
    setPendingDebounce(false);
    if (clearInputs) {
      dispatch({ type: "CLEARED", side: "original" });
      dispatch({ type: "CLEARED", side: "modified" });
      setEditing(true);
    }
    setWorkerGeneration((g) => g + 1);
  }, []);

  const onText = useCallback((side: Side, text: string, how: "paste" | "type") => {
    lastInput.current = how;
    dispatch({ type: "TEXT_EDITED", side, text });
  }, []);
  const onClear = useCallback((side: Side) => dispatch({ type: "CLEARED", side }), []);

  const loadFile = useCallback(async (side: Side, file: File) => {
    const requestId = ++readId.current;
    lastInput.current = "file";
    dispatch({ type: "FILE_SELECTED", side, fileName: file.name, requestId });
    try {
      dispatch({ type: "FILE_READ_SUCCEEDED", side, requestId, text: await readTextFile(file) });
    } catch (err) {
      const error = err instanceof TextDecodeError ? err.message : `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;
      dispatch({ type: "FILE_READ_FAILED", side, requestId, error });
    }
  }, []);

  /** Dropping two files at once fills both sides in order. */
  const onFiles = useCallback(
    (side: Side, files: File[]) => {
      const [first, second] = files;
      if (first && second) {
        // A new pair: show its result folded, even if the editors were open for the old pair.
        setEditing(false);
        void loadFile("original", first);
        void loadFile("modified", second);
      } else if (first) {
        void loadFile(side, first);
      }
    },
    [loadFile],
  );

  const cmp = state.comparison;
  const shown = cmp.status === "done" ? cmp : cmp.status === "running" ? cmp.previous : null;
  const hasResult = shown !== null;
  const canSwap = state.original.status !== "reading" && state.modified.status !== "reading";

  // When a result first appears, fold the editors into a strip so the diff gets the screen.
  // Move focus cleanly so folding an active textarea never drops focus to document.body.
  useEffect(() => {
    if (hasResult && lastInput.current !== "type") {
      setEditing((wasEditing) => {
        if (wasEditing) requestAnimationFrame(() => resultsRef.current?.focus());
        return false;
      });
    }
  }, [hasResult]);

  /** After a whole document is pasted into one empty side, move the cursor to the other empty side. */
  const onPastedWhole = useCallback(
    (side: Side) => {
      const other = side === "original" ? state.modified : state.original;
      if (other.status === "empty") (side === "original" ? modifiedRef : originalRef).current?.focus();
    },
    [state.original, state.modified],
  );

  /** Back to empty editors with the cursor in Original: the next pair is two pastes away. */
  const newComparison = () => {
    dispatch({ type: "CLEARED", side: "original" });
    dispatch({ type: "CLEARED", side: "modified" });
    setEditing(true);
    requestAnimationFrame(() => originalRef.current?.focus());
  };

  const bothEmpty = state.original.status === "empty" && state.modified.status === "empty";
  /** No result yet: the editors take the page. */
  const intake = !hasResult;
  const variant: TextPanelVariant = intake ? "intake" : editing ? "editor" : "strip";
  const openEditors = useCallback((side: Side) => {
    setEditing(true);
    requestAnimationFrame(() => (side === "original" ? originalRef : modifiedRef).current?.focus());
  }, []);
  const loadSample = (kind: TextSampleKind) => {
    const pair = textSample(kind);
    onFiles("original", [pair.original, pair.modified]);
  };
  const capture = isComparable(state)
    ? (): ComparisonSnapshot => ({
        mode: "text",
        original: toInput(state.original),
        modified: toInput(state.modified),
        options,
        onlyChanges,
      })
    : undefined;

  const openSaved = (snapshot: ComparisonSnapshot) => {
    if (snapshot.mode !== "text") return;
    lastInput.current = "file";
    setEditing(false);
    setOptions(snapshot.options);
    setOnlyChanges(snapshot.onlyChanges);
    dispatch({ type: "RESTORED", original: snapshot.original, modified: snapshot.modified });
  };

  const saved = useSavedComparisons({
    mode: "text",
    active,
    canOpen: !!client && !workerError,
    capture,
    saveLabel: "Save comparison",
    onOpen: openSaved,
  });

  const stale = cmp.status === "running" || pendingDebounce;
  const shownOriginalName = renderedNames?.original ?? displayName(state.original);
  const shownModifiedName = renderedNames?.modified ?? displayName(state.modified);

  return (
    <div className={intake ? `${modeLayout} ${intakeLayout}` : modeLayout} hidden={!active}>
      {intake ? (
        <div className={introLayout}>
          <div>
            <h1 className={introHeading}>Compare text &amp; JSON</h1>
            <p className={introDescription}>
              Paste text or drop files for line-by-line diffs with inline word highlights and structural JSON inspection.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {saved.historyButton}
            <Button variant="outline" size="sm" onClick={() => loadSample("json")}>
              JSON sample
            </Button>
            <Button variant="outline" size="sm" onClick={() => loadSample("text")}>
              Text sample
            </Button>
          </div>
        </div>
      ) : (
        <h1 className="sr-only">Text and JSON comparison</h1>
      )}

      {variant === "strip" ? (
        <section
          id="text-inputs"
          className={`${panel} grid grid-cols-1 divide-y divide-border min-[721px]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] min-[721px]:divide-x min-[721px]:divide-y-0`}
          aria-label="Inputs"
        >
          <TextInputPanel
            variant="strip"
            label="Original"
            side="original"
            slot={state.original}
            onText={onText}
            onFiles={onFiles}
            onClear={onClear}
            onEdit={openEditors}
            onPastedWhole={onPastedWhole}
            textareaRef={originalRef}
          />
          <div className="hidden items-center justify-center bg-surface-subtle/50 px-1 min-[721px]:flex">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => dispatch({ type: "SWAPPED" })}
              disabled={!canSwap}
              aria-label="Swap Original and Modified"
              title="Swap Original and Modified"
            >
              <Icon name="swap" size={14} />
            </Button>
          </div>
          <TextInputPanel
            variant="strip"
            label="Modified"
            side="modified"
            slot={state.modified}
            onText={onText}
            onFiles={onFiles}
            onClear={onClear}
            onEdit={openEditors}
            onPastedWhole={onPastedWhole}
            textareaRef={modifiedRef}
          />
        </section>
      ) : (
        <FieldGroup id="text-inputs" className={inputsLayout} role="region" aria-label="Inputs">
          {(["original", "modified"] as const).map((side) => (
            <TextInputPanel
              key={side}
              variant={variant}
              label={side === "original" ? "Original" : "Modified"}
              side={side}
              slot={state[side]}
              onText={onText}
              onFiles={onFiles}
              onClear={onClear}
              onEdit={openEditors}
              onPastedWhole={onPastedWhole}
              textareaRef={side === "original" ? originalRef : modifiedRef}
            />
          ))}
        </FieldGroup>
      )}

      <DropOverlay enabled={active && !saved.isOpen} names={{ original: slotName(state.original), modified: slotName(state.modified) }} onFiles={onFiles} />

      {bothEmpty ? (
        <div className={intakeNote}>
          <p>Paste directly into either pane or drop two files anywhere on the page. JSON is detected and formatted automatically.</p>
        </div>
      ) : (
        <TextOptionsBar
          options={options}
          onChange={setOptions}
          resolved={shown?.diff.format ?? null}
          showFilter={isComparable(state)}
          onlyChanges={onlyChanges}
          onOnlyChangesChange={setOnlyChanges}
          subrow={saved.toolbarSubrow}
          actions={
            <>
              <Button
                variant="ghost"
                size="sm"
                className={variant === "strip" ? "min-[721px]:hidden" : undefined}
                onClick={() => dispatch({ type: "SWAPPED" })}
                disabled={!canSwap}
                title="Swap Original and Modified"
              >
                <Icon name="swap" size={14} /> Swap
              </Button>
              {hasResult && (
                <Button variant="outline" size="sm" onClick={() => setEditing((e) => !e)} aria-expanded={variant === "editor"} aria-controls="text-inputs">
                  {variant === "editor" ? "Hide inputs" : "Edit inputs"}
                </Button>
              )}
              {saved.saveActions}
              {saved.historyButton}
              <Button size="sm" onClick={newComparison} title="Clear both sides and paste or drop the next pair">
                New comparison
              </Button>
            </>
          }
        />
      )}

      {saved.dialogElement}

      {workerError && (
        <div className={`${errorBanner} items-center justify-between gap-3`} role="alert">
          <span>The text comparison engine stopped: {workerError}</span>
          <Button variant="outline" size="xs" onClick={() => restartEngine(false)}>
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

      <section
        ref={resultsRef}
        tabIndex={-1}
        className={`${resultLayout} focus:outline-none`}
        aria-label="Text comparison results"
        hidden={cmp.status === "idle" && !hasResult}
      >
        {cmp.status === "running" && !shown && (
          <div className={resultPlaceholder} role="status">
            <span className="inline-flex items-center gap-2">
              <span className={spinner} /> Comparing…
            </span>
            {slowRun && (
              <Button variant="outline" size="xs" onClick={() => restartEngine(true)}>
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
          (shown.diff.identical ? (
            <section
              className={`${panel} flex flex-col gap-3 p-5 wrap-anywhere data-[stale=true]:opacity-75`}
              data-stale={stale}
              aria-live="polite"
            >
              <div className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-add/25 bg-add-tint text-add" aria-hidden>
                  <Icon name="check" size={18} />
                </span>
                <div>
                  <h2 className="text-base font-semibold tracking-tight text-foreground">No differences found</h2>
                  <p className="mt-0.5 text-sm text-pretty text-muted-foreground">
                    {plural(shown.diff.counts.unchanged, "line")} compared as {shown.diff.format === "json" ? "JSON" : "plain text"}.
                    {shown.diff.rawIdentical ? " The inputs are byte-for-byte identical." : ""}
                  </p>
                </div>
              </div>
              {shown.diff.notes.map((n, i) => (
                <p key={i} className={n.level === "warning" ? warningBanner : infoBanner}>
                  {n.message}
                </p>
              ))}
            </section>
          ) : (
            <TextDiffView
              diff={shown.diff}
              diffMs={shown.diffMs}
              onlyChanges={onlyChanges}
              originalName={shownOriginalName}
              modifiedName={shownModifiedName}
              stale={stale}
              keysEnabled={active && !saved.isOpen}
            />
          ))}
      </section>
    </div>
  );
}

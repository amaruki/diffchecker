import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BookmarkPlusIcon, CheckIcon, ChevronDownIcon, HistoryIcon, Trash2Icon, XIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  deleteSavedComparison,
  listSavedComparisons,
  openSavedComparison,
  saveComparison,
  SAVED_COMPARISON_PREFIX,
  type ComparisonSnapshot,
  type SavedComparison,
} from "../state/savedComparisons";
import { errorBanner, panel } from "./styles";

interface UseSavedComparisonsOptions {
  mode: ComparisonSnapshot["mode"];
  active: boolean;
  canOpen: boolean;
  capture?: () => ComparisonSnapshot;
  captureSources?: () => ComparisonSnapshot;
  saveLabel?: string;
  onOpen: (snapshot: ComparisonSnapshot, key: string) => void | Promise<void>;
  onDeleted?: (key: string) => void;
}

function storageError(error: unknown): string {
  if (error instanceof DOMException && error.name === "QuotaExceededError") {
    return "Browser storage is full or this comparison is too large to save.";
  }
  if (error instanceof DOMException && error.name === "SecurityError") {
    return "This browser blocked access to saved comparisons.";
  }
  return error instanceof Error ? error.message : String(error);
}

type Operation = { kind: "saving" | "saving-sources" } | { kind: "opening" | "deleting"; key: string };
type Notice = { error: boolean; message: string };

function HistoryEntry({
  entry,
  workbook,
  operation,
  canOpen,
  confirmingDelete,
  onOpen,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  entry: SavedComparison;
  workbook: boolean;
  operation: Operation | null;
  canOpen: boolean;
  confirmingDelete: boolean;
  onOpen: () => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}) {
  const labelId = useId();
  const deleteBtnRef = useRef<HTMLButtonElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  const date = new Date(entry.savedAt);
  const opening = operation?.kind === "opening" && operation.key === entry.key;
  const deleting = operation?.kind === "deleting" && operation.key === entry.key;

  // Preserve keyboard focus when toggling inline delete confirmation.
  useEffect(() => {
    if (confirmingDelete && !wasConfirming.current) {
      cancelBtnRef.current?.focus();
    } else if (!confirmingDelete && wasConfirming.current) {
      deleteBtnRef.current?.focus();
    }
    wasConfirming.current = confirmingDelete;
  }, [confirmingDelete]);

  return (
    <li className="flex flex-col gap-3 border-b border-border py-3.5 last:border-b-0 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1 space-y-1.5">
        {entry.savedAt ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {workbook && (
                <Badge tone={entry.kind === "result" ? "accent" : "neutral"}>
                  {entry.kind === "result" ? "Result only" : "With workbooks"}
                </Badge>
              )}
              <time dateTime={date.toISOString()} className="tabular-nums">
                {date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
              </time>
            </div>
            <dl id={labelId} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-0.5 text-xs">
              <dt className="text-muted-foreground">Original</dt>
              <dd className="font-mono text-foreground wrap-anywhere">{entry.originalName}</dd>
              <dt className="text-muted-foreground">Modified</dt>
              <dd className="font-mono text-foreground wrap-anywhere">{entry.modifiedName}</dd>
            </dl>
          </>
        ) : (
          <p id={labelId} className="text-xs text-muted-foreground">
            {entry.originalName}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        {confirmingDelete ? (
          <>
            <Button variant="danger" size="xs" disabled={operation !== null} onClick={onConfirmDelete}>
              {deleting ? "Deleting…" : "Confirm delete"}
            </Button>
            <Button ref={cancelBtnRef} variant="ghost" size="xs" disabled={operation !== null} onClick={onCancelDelete}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" size="xs" disabled={!canOpen || operation !== null} aria-describedby={labelId} onClick={onOpen}>
              {opening ? "Opening…" : "Open"}
            </Button>
            <Button
              ref={deleteBtnRef}
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:bg-remove-tint hover:text-remove"
              disabled={operation !== null}
              aria-label={`Delete saved comparison ${entry.originalName} vs ${entry.modifiedName}`}
              title="Delete saved comparison"
              onClick={onRequestDelete}
            >
              <Trash2Icon aria-hidden />
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

function StorageNotice({ notice, onDismiss }: { notice: Notice; onDismiss?: () => void }) {
  return (
    <div
      className={
        notice.error
          ? `${errorBanner} items-center justify-between`
          : "flex items-center justify-between gap-2 rounded-md border border-add/25 bg-add-tint px-3 py-1.5 text-xs text-add"
      }
      role={notice.error ? "alert" : "status"}
    >
      <span className="flex items-center gap-1.5">
        {!notice.error && <CheckIcon className="size-3.5 shrink-0" aria-hidden />}
        {notice.message}
      </span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss message"
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-current/70 hover:bg-current/10 hover:text-current pointer-coarse:size-11"
        >
          <XIcon className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

/**
 * Manages browser-saved comparisons and exposes compact inline controls + modal dialog
 * so history & saving integrate seamlessly into the workbench chrome without extra floating bars.
 */
export function useSavedComparisons({
  mode,
  active,
  canOpen,
  capture,
  captureSources,
  saveLabel = "Save",
  onOpen,
  onDeleted,
}: UseSavedComparisonsOptions) {
  const [entries, setEntries] = useState<SavedComparison[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);
  const refreshId = useRef(0);
  const openTokenRef = useRef(0);
  const backdropPressRef = useRef(false);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const saveOptionsBtnRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const optionsPanelId = useId();
  const [toolbarNotice, setToolbarNotice] = useState<Notice | null>(null);
  const [dialogNotice, setDialogNotice] = useState<Notice | null>(null);

  const showSave = !!capture || operation?.kind === "saving";
  const showSourceOption = !!captureSources || operation?.kind === "saving-sources";

  useEffect(() => {
    if (!active) {
      openTokenRef.current++;
      dialog.current?.close();
      setOptionsOpen(false);
    }
  }, [active]);

  useEffect(() => {
    return () => {
      openTokenRef.current++;
    };
  }, []);

  useEffect(() => {
    if (!showSourceOption) setOptionsOpen(false);
  }, [showSourceOption]);

  useEffect(() => {
    if (!optionsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOptionsOpen(false);
        requestAnimationFrame(() => saveOptionsBtnRef.current?.focus());
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [optionsOpen]);

  const refresh = useCallback(async () => {
    const id = ++refreshId.current;
    try {
      const latest = await listSavedComparisons(mode);
      if (refreshId.current === id) setEntries(latest);
    } catch (error) {
      if (refreshId.current === id) setDialogNotice({ error: true, message: storageError(error) });
    }
  }, [mode]);

  useEffect(() => {
    const channel = mode === "sheet" && typeof BroadcastChannel === "function" ? new BroadcastChannel("diffcheck-workbook-history") : null;
    channelRef.current = channel;
    const refreshIfExpanded = () => {
      if (expanded) void refresh();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith(SAVED_COMPARISON_PREFIX + mode + ":")) refreshIfExpanded();
    };
    refreshIfExpanded();
    channel?.addEventListener("message", refreshIfExpanded);
    window.addEventListener("focus", refreshIfExpanded);
    window.addEventListener("storage", onStorage);
    return () => {
      refreshId.current++;
      channelRef.current = null;
      channel?.close();
      window.removeEventListener("focus", refreshIfExpanded);
      window.removeEventListener("storage", onStorage);
    };
  }, [expanded, mode, refresh]);

  const notifyPeers = () => {
    try {
      channelRef.current?.postMessage(null);
    } catch {
      // Ignore if the channel was closed during unmount.
    }
  };

  const save = async (kind: "saving" | "saving-sources", getSnapshot?: () => ComparisonSnapshot) => {
    if (!getSnapshot || operation) return;
    setOperation({ kind });
    setOptionsOpen(false);
    setToolbarNotice(null);
    try {
      const entry = await saveComparison(getSnapshot());
      setEntries((current) => current && [entry, ...current]);
      notifyPeers();
      setToolbarNotice({
        error: false,
        message: entry.kind === "result" ? "Result saved in this browser." : "Comparison saved in this browser.",
      });
      void refresh();
    } catch (error) {
      setToolbarNotice({ error: true, message: storageError(error) });
    } finally {
      setOperation(null);
    }
  };

  const openEntry = async (entry: SavedComparison) => {
    if ((!canOpen && entry.kind !== "result") || operation) return;
    const { key } = entry;
    const token = ++openTokenRef.current;
    setOperation({ kind: "opening", key });
    setConfirmDeleteKey(null);
    setDialogNotice(null);
    try {
      const snapshot = await openSavedComparison(mode, key);
      if (openTokenRef.current !== token) return;
      dialog.current?.close();
      await onOpen(snapshot, key);
    } catch (error) {
      if (openTokenRef.current === token) setDialogNotice({ error: true, message: storageError(error) });
    } finally {
      setOperation(null);
    }
  };

  const removeEntry = async ({ key }: SavedComparison) => {
    if (operation) return;
    setOperation({ kind: "deleting", key });
    setDialogNotice(null);
    try {
      await deleteSavedComparison(mode, key);
      setEntries((current) => current?.filter((entry) => entry.key !== key) ?? null);
      setConfirmDeleteKey(null);
      onDeleted?.(key);
      closeButton.current?.focus();
      notifyPeers();
      setDialogNotice({ error: false, message: "Saved comparison deleted." });
      void refresh();
    } catch (error) {
      setDialogNotice({ error: true, message: storageError(error) });
    } finally {
      setOperation(null);
    }
  };

  const openHistory = () => {
    if (!operation) setDialogNotice(null);
    setOptionsOpen(false);
    setConfirmDeleteKey(null);
    dialog.current?.showModal();
    setExpanded(true);
  };

  const saveActions =
    showSave || showSourceOption ? (
      <div className="inline-flex min-w-0 items-stretch">
        {showSave && (
          <Button
            className={showSourceOption ? "rounded-r-none border-r-0" : undefined}
            variant="outline"
            size="sm"
            onClick={() => void save("saving", capture)}
            disabled={operation !== null}
          >
            <BookmarkPlusIcon aria-hidden />
            {operation?.kind === "saving" ? "Saving…" : saveLabel}
          </Button>
        )}
        {showSourceOption && (
          <Button
            ref={saveOptionsBtnRef}
            variant="outline"
            size={showSave ? "icon" : "sm"}
            className={showSave ? "h-auto rounded-l-none" : undefined}
            aria-expanded={optionsOpen}
            aria-controls={optionsPanelId}
            aria-label="Save options"
            title="Save options"
            disabled={operation !== null}
            onClick={() => setOptionsOpen((open) => !open)}
          >
            {!showSave && "Save options"}
            <ChevronDownIcon
              className={optionsOpen ? "rotate-180 motion-safe:transition-transform" : "motion-safe:transition-transform"}
              aria-hidden
            />
          </Button>
        )}
      </div>
    ) : null;

  const historyButton = (
    <Button variant="ghost" size="sm" aria-haspopup="dialog" onClick={openHistory}>
      <HistoryIcon aria-hidden />
      <span>Saved</span>
    </Button>
  );

  const toolbarSubrow =
    optionsOpen || toolbarNotice || operation?.kind === "saving-sources" ? (
      <div className="mt-2 flex flex-col gap-2 border-t border-border pt-2">
        {optionsOpen && showSourceOption && (
          <div id={optionsPanelId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-0.5">
            <Button variant="outline" size="xs" disabled={!!operation} onClick={() => void save("saving-sources", captureSources)}>
              Save with source workbooks
            </Button>
            <p className="text-xs text-muted-foreground">Keep both .xlsx files in this browser so you can reopen and change settings later.</p>
          </div>
        )}
        {operation?.kind === "saving-sources" && (
          <p className="px-0.5 text-xs text-muted-foreground" role="status">
            Saving source workbooks…
          </p>
        )}
        {toolbarNotice && <StorageNotice notice={toolbarNotice} onDismiss={() => setToolbarNotice(null)} />}
      </div>
    ) : null;

  const dialogElement = (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className={`${panel} fixed inset-x-0 top-auto bottom-0 m-0 w-full max-w-none rounded-b-none p-0 text-foreground shadow-lg backdrop:bg-black/45 backdrop:backdrop-blur-[2px] sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-[min(36rem,calc(100vw-2rem))] sm:-translate-1/2 sm:rounded-xl`}
      onClose={() => {
        openTokenRef.current++;
        setExpanded(false);
        setConfirmDeleteKey(null);
        setDialogNotice(null);
      }}
      onPointerDown={(event) => {
        backdropPressRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (backdropPressRef.current && event.target === event.currentTarget) dialog.current?.close();
        backdropPressRef.current = false;
      }}
    >
      <div className="flex max-h-[82dvh] flex-col">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2">
            <h2 id={titleId} className="text-sm font-semibold text-foreground">
              Saved comparisons
            </h2>
            {entries && entries.length > 0 && <Badge tone="neutral">{entries.length}</Badge>}
          </div>
          <Button ref={closeButton} variant="ghost" size="icon-xs" aria-label="Close saved comparisons" onClick={() => dialog.current?.close()}>
            <XIcon aria-hidden />
          </Button>
        </header>
        <div className="workbench-scroll min-h-0 overflow-y-auto overscroll-contain px-4 pb-4 sm:px-5">
          {dialogNotice && (
            <div className="pt-3">
              <StorageNotice notice={dialogNotice} onDismiss={() => setDialogNotice(null)} />
            </div>
          )}
          {entries?.length ? (
            <ul>
              {entries.map((entry) => (
                <HistoryEntry
                  key={entry.key}
                  entry={entry}
                  workbook={mode === "sheet"}
                  operation={operation}
                  canOpen={!!entry.savedAt && (canOpen || entry.kind === "result")}
                  confirmingDelete={confirmDeleteKey === entry.key}
                  onOpen={() => void openEntry(entry)}
                  onRequestDelete={() => setConfirmDeleteKey(entry.key)}
                  onConfirmDelete={() => void removeEntry(entry)}
                  onCancelDelete={() => setConfirmDeleteKey(null)}
                />
              ))}
            </ul>
          ) : (
            !dialogNotice?.error && (
              <div className="flex flex-col items-center justify-center gap-1.5 py-10 text-center" role="status">
                <HistoryIcon className="size-5 text-muted-foreground/60" aria-hidden />
                <p className="text-sm font-medium text-foreground">{entries ? "No saved comparisons yet" : "Loading saved comparisons…"}</p>
                {entries && <p className="max-w-xs text-xs text-muted-foreground">Saved results stay locally in this browser for quick reference.</p>}
              </div>
            )
          )}
        </div>
      </div>
    </dialog>
  );

  return {
    isOpen: expanded,
    saveActions,
    historyButton,
    toolbarSubrow,
    dialogElement,
    openHistory,
  };
}

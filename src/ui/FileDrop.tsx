import { Button } from "@/components/ui/button";
import { panel, sideLabel, spinner } from "./styles";
import { useRef } from "react";
import type { SlotState } from "../state/machine";
import type { Side } from "../worker/protocol";
import { Icon } from "./Icon";
import { plural } from "./summary";

/** "intake": large drop target, used while no file is loaded. "strip": one line, used after. */
export type SlotVariant = "intake" | "strip";

interface FileDropProps {
  variant: SlotVariant;
  label: string;
  side: Side;
  slot: SlotState;
  onFiles: (side: Side, files: File[]) => void;
  onClear: (side: Side) => void;
}

export function FileDrop({ variant, label, side, slot, onFiles, onClear }: FileDropProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const browse = () => inputRef.current?.click();

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      hidden
      multiple
      onChange={(e) => {
        const files = Array.from(e.currentTarget.files ?? []);
        e.currentTarget.value = "";
        if (files.length > 0) onFiles(side, files);
      }}
    />
  );

  if (variant === "intake") {
    return (
      // Drops are handled by the page-wide DropOverlay, which covers this zone during a drag.
      <div className={`${panel} flex flex-col overflow-hidden data-[status=failed]:border-remove`} data-status={slot.status}>
        <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-subtle/60 px-4 py-2.5">
          <span className={sideLabel} data-side={side}>
            {label}
          </span>
          <span id={`workbook-${side}-types`} className="font-mono text-[11px] text-muted-foreground">
            .xlsx · .xlsm
          </span>
        </div>
        <div className="p-3.5">
          <button
            type="button"
            onClick={browse}
            aria-label={`Choose file for ${label.toLowerCase()} workbook`}
            aria-describedby={`workbook-${side}-types`}
            className="group flex min-h-[clamp(9rem,17vw,12rem)] w-full flex-col items-center justify-center gap-2.5 rounded-md border border-dashed border-border-strong bg-background/60 p-4 text-center outline-none motion-safe:transition-[border-color,background-color] hover:border-foreground/50 hover:bg-surface-subtle/70 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35"
          >
            <span className="grid size-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground shadow-2xs motion-safe:transition-colors group-hover:border-border-strong group-hover:text-foreground">
              <Icon name="upload" size={16} />
            </span>
            <span className="text-[13px] font-medium text-foreground">Select {label.toLowerCase()} workbook</span>
            <span className="text-xs text-muted-foreground">Click to browse or drop a file anywhere</span>
          </button>
        </div>
        {fileInput}
      </div>
    );
  }

  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-2 px-3 py-1.5 data-[status=failed]:bg-remove-tint/50"
      data-status={slot.status}
    >
      <span className={sideLabel} data-side={side}>
        {label}
      </span>

      {slot.status === "empty" && (
        <Button size="xs" variant="outline" className="ml-auto" onClick={browse} aria-label={`Choose file for ${label.toLowerCase()} workbook`}>
          <Icon name="upload" size={13} /> Choose file
        </Button>
      )}

      {slot.status === "parsing" && (
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground" aria-live="polite">
          <span className={spinner} />
          <span>Reading</span>
          <strong className="truncate font-mono font-medium text-foreground">{slot.fileName}</strong>
        </span>
      )}

      {slot.status === "ready" && (
        <span className="flex min-w-0 flex-1 items-baseline gap-2 text-xs">
          <strong className="min-w-0 truncate font-mono font-medium text-foreground" title={slot.fileName}>
            {slot.fileName}
          </strong>
          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
            {plural(slot.workbook.sheets.length, "sheet")}
          </span>
        </span>
      )}

      {slot.status === "failed" && (
        <span className="min-w-0 flex-1 text-xs text-remove wrap-anywhere" role="alert">
          <strong className="font-mono font-medium">{slot.fileName}</strong>: {slot.error}
        </span>
      )}

      {slot.status !== "empty" && (
        <span className="ml-auto inline-flex shrink-0 items-center gap-1">
          {slot.status !== "parsing" && (
            <Button
              variant="ghost"
              size="xs"
              onClick={browse}
              aria-label={`${slot.status === "failed" ? "Choose another file for" : "Replace"} ${label.toLowerCase()} workbook`}
            >
              {slot.status === "failed" ? "Choose another" : "Replace"}
            </Button>
          )}
          <Button variant="ghost" size="icon-xs" onClick={() => onClear(side)} aria-label={`Clear ${label}`} title={`Clear ${label}`}>
            <Icon name="close" size={14} />
          </Button>
        </span>
      )}

      {fileInput}
    </div>
  );
}

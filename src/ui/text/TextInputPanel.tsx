import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { panel, sideLabel, spinner } from "../styles";
import { useId, useRef, type RefObject } from "react";
import type { TextSlot } from "../../state/textMachine";
import { Icon } from "../Icon";
import type { Side } from "../../worker/protocol";

/** Above this many characters the text is shown as a summary instead of an editable textarea. */
export const EDIT_LIMIT = 1_000_000;

/** "intake": tall editor while both sides are empty. "editor": normal editor. "strip": one-line summary. */
export type TextPanelVariant = "intake" | "editor" | "strip";

interface TextInputPanelProps {
  variant: TextPanelVariant;
  label: string;
  side: Side;
  slot: TextSlot;
  onText: (side: Side, text: string, how: "paste" | "type") => void;
  onFiles: (side: Side, files: File[]) => void;
  onClear: (side: Side) => void;
  /** Opens the editors; used by the strip variant. */
  onEdit: (side: Side) => void;
  /** Called after a paste that filled this editor while it was empty. */
  onPastedWhole: (side: Side) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

function lineCount(text: string): number {
  let n = text === "" ? 0 : 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

export function TextInputPanel({
  variant,
  label,
  side,
  slot,
  onText,
  onFiles,
  onClear,
  onEdit,
  onPastedWhole,
  textareaRef,
}: TextInputPanelProps) {
  const editorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  /** Set by onPaste into an empty editor, read by the onChange that follows it. */
  const pastedWhole = useRef(false);
  const text = slot.status === "ready" ? slot.text : "";
  const tooLarge = text.length > EDIT_LIMIT;
  const compactActions = variant === "strip";
  const editable = !compactActions && slot.status !== "failed" && !tooLarge;
  const readyName = slot.status === "ready" ? (slot.fileName ?? "Pasted text") : undefined;
  const readyMeta =
    slot.status === "ready" ? `${lineCount(text).toLocaleString()} lines · ${text.length.toLocaleString()} chars` : undefined;
  const readyTitle = readyName && readyMeta ? `${readyName} · ${readyMeta}` : undefined;
  const browse = () => inputRef.current?.click();

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      hidden
      multiple
      onChange={(e) => {
        const files = Array.from(e.currentTarget.files ?? []);
        e.currentTarget.value = "";
        if (files.length > 0) onFiles(side, files);
      }}
    />
  );

  if (variant === "strip") {
    return (
      <div className="flex min-w-0 items-center gap-2 px-3 py-1.5 data-invalid:bg-remove-tint/50" data-invalid={slot.status === "failed" || undefined}>
        <span className={sideLabel} data-side={side}>
          {label}
        </span>

        <div className="flex min-w-0 flex-1 items-baseline gap-2 text-xs" title={readyTitle}>
          {slot.status === "ready" && (
            <>
              <strong className="min-w-0 truncate font-mono font-medium text-foreground">{readyName}</strong>
              <span className="hidden shrink-0 text-[11px] text-muted-foreground tabular-nums sm:inline">{readyMeta}</span>
            </>
          )}
          {slot.status === "reading" && (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground" role="status">
              <span className={spinner} /> Reading {slot.fileName}…
            </span>
          )}
          {slot.status === "failed" && (
            <span className="truncate text-remove" role="alert">
              {slot.fileName}: {slot.error}
            </span>
          )}
          {slot.status === "empty" && <span className="text-muted-foreground">(empty)</span>}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="xs"
            className="max-[480px]:size-8 max-[480px]:px-0"
            onClick={() => onEdit(side)}
            aria-label={`Edit ${label.toLowerCase()} text`}
            title={`Edit ${label.toLowerCase()} text`}
          >
            <Icon name="edit" size={13} />
            <span className="max-[480px]:sr-only">Edit</span>
          </Button>
          <Button
            variant="ghost"
            size="xs"
            className="max-[480px]:size-8 max-[480px]:px-0"
            onClick={browse}
            aria-label={`Open file for ${label.toLowerCase()} text`}
            title={`Open file for ${label.toLowerCase()} text`}
          >
            <Icon name="upload" size={13} />
            <span className="max-[480px]:sr-only">Open</span>
          </Button>
          {slot.status !== "empty" && (
            <Button variant="ghost" size="icon-xs" onClick={() => onClear(side)} aria-label={`Clear ${label}`} title={`Clear ${label}`}>
              <Icon name="close" size={14} />
            </Button>
          )}
        </div>
        {fileInput}
      </div>
    );
  }

  return (
    // Drops are handled by the page-wide DropOverlay, which covers this panel during a file drag.
    <Field
      className={`${panel} gap-0 overflow-hidden data-invalid:border-remove`}
      data-invalid={slot.status === "failed" || undefined}
    >
      <div className="flex min-w-0 items-center gap-2 border-b border-border bg-surface-subtle/60 px-3 py-2 sm:px-3.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {editable ? (
            <FieldLabel htmlFor={editorId} className={sideLabel} data-side={side}>
              {label}
            </FieldLabel>
          ) : (
            <span className={sideLabel} data-side={side}>
              {label}
            </span>
          )}
          {slot.status === "ready" && (
            <span className="truncate font-mono text-[11px] text-muted-foreground tabular-nums" title={readyTitle}>
              {slot.fileName ? `${slot.fileName} · ` : ""}
              {readyMeta}
            </span>
          )}
          {slot.status === "reading" && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
              <span className={spinner} /> Reading {slot.fileName}…
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="outline"
            size="xs"
            onClick={browse}
            aria-label={`Open file for ${label.toLowerCase()} text`}
            title={`Open file for ${label.toLowerCase()} text`}
          >
            <Icon name="upload" size={13} />
            Open file
          </Button>
          {slot.status !== "empty" && (
            <Button variant="ghost" size="icon-xs" onClick={() => onClear(side)} aria-label={`Clear ${label}`} title={`Clear ${label}`}>
              <Icon name="close" size={14} />
            </Button>
          )}
        </div>
      </div>

      {slot.status === "failed" ? (
        <p className="min-h-20 p-3.5 text-xs text-remove wrap-anywhere" role="alert">
          <strong className="font-mono font-medium">{slot.fileName}</strong>: {slot.error}
        </p>
      ) : tooLarge ? (
        <p className="min-h-20 p-3.5 text-xs text-muted-foreground wrap-anywhere">
          This text is too large to edit inline ({text.length.toLocaleString()} characters). It is still compared in full.
        </p>
      ) : (
        <Textarea
          id={editorId}
          ref={textareaRef}
          className="workbench-scroll resize-y rounded-none border-0 bg-card px-3.5 py-3 font-mono text-[13px] leading-relaxed shadow-none focus-visible:ring-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring data-[variant=intake]:h-[clamp(11rem,22vw,16rem)]"
          data-variant={variant}
          value={text}
          placeholder={`Paste ${label.toLowerCase()} text or JSON here…`}
          spellCheck={false}
          wrap="off"
          disabled={slot.status === "reading"}
          autoCapitalize="off"
          autoComplete="off"
          onPaste={() => {
            pastedWhole.current = text === "";
          }}
          onChange={(e) => {
            onText(side, e.currentTarget.value, pastedWhole.current ? "paste" : "type");
            if (pastedWhole.current) onPastedWhole(side);
            pastedWhole.current = false;
          }}
        />
      )}

      {fileInput}
    </Field>
  );
}

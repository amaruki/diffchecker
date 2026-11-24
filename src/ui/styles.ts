// Shared Tailwind classes for workbench layout, frames, and controls across both modes.
export const panel = "min-w-0 rounded-lg border border-border bg-card";
export const modeLayout = "flex min-w-0 flex-col gap-2.5 min-[901px]:min-h-0 min-[901px]:flex-1";
export const intakeLayout = "mx-auto w-full max-w-5xl gap-4 pt-2 sm:pt-[clamp(1.25rem,4vh,2.75rem)]";
export const inputsLayout = "grid min-w-0 grid-cols-1 gap-3 min-[721px]:grid-cols-2";
export const introLayout = "flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between";
export const introHeading = "text-xl font-semibold tracking-tight text-balance text-foreground sm:text-[1.625rem] sm:leading-tight";
export const introDescription = "mt-1 max-w-[54ch] text-sm leading-relaxed text-pretty text-muted-foreground";
export const intakeNote = "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border/80 pt-3.5 text-xs text-muted-foreground";

export const sideLabel =
  "inline-flex shrink-0 items-center gap-1.5 text-[13px] font-medium leading-tight text-foreground before:size-1.5 before:shrink-0 before:rounded-full before:bg-muted-foreground/65 data-[side=modified]:before:bg-signal data-[side=mod]:before:bg-signal";

export const resultLayout = "flex min-w-0 flex-col gap-2 min-[901px]:min-h-0 min-[901px]:flex-1";
export const resultPlaceholder =
  panel + " flex flex-col items-center justify-center gap-2 border-dashed p-10 text-center text-sm text-muted-foreground wrap-anywhere";

export const banner = "flex items-start gap-2 rounded-md border border-l-2 px-3 py-2 text-xs leading-relaxed wrap-anywhere";
export const errorBanner = banner + " border-remove/20 border-l-remove bg-remove-tint text-remove";
export const warningBanner = banner + " border-change/25 border-l-change bg-change-tint text-change";
export const infoBanner = banner + " border-border border-l-muted-foreground bg-surface-subtle text-foreground";

export const spinner =
  "mr-1 inline-block size-3.5 shrink-0 align-[-2px] rounded-full border-[1.75px] border-border-strong border-t-foreground motion-safe:animate-spin";

export const divider = "hidden h-3.5 w-px shrink-0 bg-border min-[721px]:block";
export const kbdKey =
  "inline-flex min-w-[1.25rem] items-center justify-center rounded-[4px] border border-border bg-surface-subtle px-1 py-0.5 font-mono text-[10px] font-medium leading-none text-muted-foreground";

export const summaryFrame = panel + " flex flex-col";
export const summaryRow = "flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5 px-3 py-2 text-xs";

export const paneLayout =
  "grid min-w-0 grid-cols-1 grid-rows-[repeat(2,clamp(200px,40svh,360px))] gap-2.5 min-[901px]:min-h-65 min-[901px]:flex-1 min-[901px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_12px] min-[901px]:grid-rows-[minmax(0,1fr)] min-[901px]:gap-0 min-[901px]:overflow-hidden min-[901px]:rounded-lg min-[901px]:border min-[901px]:border-border min-[901px]:bg-card";

export const paneFrame =
  "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card min-[901px]:rounded-none min-[901px]:border-0 min-[901px]:border-r min-[901px]:border-border";

export const paneTitle =
  "flex min-h-8 shrink-0 items-center gap-2 border-b border-border bg-surface-subtle px-3 py-1.5 text-xs font-medium text-foreground";

export const paneScroll =
  "workbench-scroll relative flex-1 overflow-auto [contain:strict] focus-visible:-outline-offset-2";

export const ghostPattern = "[background-image:var(--hatch)]";

export const gutterStatus =
  "group-data-[selected=true]:font-semibold group-data-[selected=true]:text-signal group-data-[status=added]:border-l-[3px] group-data-[status=added]:border-l-add group-data-[status=removed]:border-l-[3px] group-data-[status=removed]:border-l-remove group-data-[status=changed]:border-l-[3px] group-data-[status=changed]:border-l-change";

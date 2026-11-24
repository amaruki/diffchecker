import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const tones = {
  add: "bg-add-tint text-add border-add/20",
  rem: "bg-remove-tint text-remove border-remove/20",
  chg: "bg-change-tint text-change border-change/20",
  neutral: "bg-muted text-muted-foreground border-border",
  accent: "bg-signal-subtle text-accent-foreground border-signal/25",
} as const;

export function Badge({
  className,
  tone = "neutral",
  ...props
}: ComponentProps<"span"> & { tone?: keyof typeof tones }) {
  return (
    <span
      data-slot="badge"
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-[4px] border px-1.5 py-0.5 text-[11px] font-medium leading-tight tabular-nums",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

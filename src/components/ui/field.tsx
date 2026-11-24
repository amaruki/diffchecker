import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function FieldGroup({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="field-group" className={cn("flex min-w-0 flex-col gap-3.5", className)} {...props} />;
}

export function Field({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="field" role="group" className={cn("flex min-w-0 flex-col gap-1.5", className)} {...props} />;
}

export function FieldLabel({ className, ...props }: ComponentProps<"label">) {
  return <label data-slot="field-label" className={cn("text-xs font-medium leading-snug text-foreground", className)} {...props} />;
}

export function FieldDescription({ className, ...props }: ComponentProps<"p">) {
  return <p data-slot="field-description" className={cn("text-xs leading-relaxed text-pretty text-muted-foreground", className)} {...props} />;
}

export function FieldError({ className, ...props }: ComponentProps<"p">) {
  return <p data-slot="field-error" role="alert" className={cn("text-xs font-medium text-remove", className)} {...props} />;
}

export function FieldSet({ className, ...props }: ComponentProps<"fieldset">) {
  return <fieldset data-slot="field-set" className={cn("min-w-0", className)} {...props} />;
}

export function FieldLegend({ className, ...props }: ComponentProps<"legend">) {
  return <legend data-slot="field-legend" className={cn("mb-1.5 text-xs font-medium text-foreground", className)} {...props} />;
}

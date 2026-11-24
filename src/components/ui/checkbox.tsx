import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-border-strong bg-card outline-none motion-safe:transition-[background-color,border-color] hover:border-foreground/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground disabled:opacity-45",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator">
        <CheckIcon className="size-3 stroke-[2.5]" aria-hidden />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

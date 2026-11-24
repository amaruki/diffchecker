import type { ComponentProps } from "react";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function NativeSelect({ className, ...props }: ComponentProps<"select">) {
  return (
    <div data-slot="native-select-wrapper" className="relative w-full">
      <select
        data-slot="native-select"
        className={cn(
          "min-h-9 w-full min-w-0 appearance-none rounded-md border border-input bg-card py-1.5 pr-8 pl-2.5 text-base text-foreground shadow-2xs outline-none motion-safe:transition-[border-color,box-shadow] hover:border-border-strong focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35 disabled:opacity-45 pointer-coarse:min-h-11 sm:text-[13px]",
          className,
        )}
        {...props}
      />
      <ChevronDownIcon
        data-slot="native-select-icon"
        className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
    </div>
  );
}

export function NativeSelectOption(props: ComponentProps<"option">) {
  return <option data-slot="native-select-option" {...props} />;
}

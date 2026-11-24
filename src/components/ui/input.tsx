import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: InputPrimitive.Props) {
  return (
    <InputPrimitive
      data-slot="input"
      className={cn(
        "min-h-9 w-full min-w-0 rounded-md border border-input bg-card px-2.5 text-base text-foreground shadow-2xs outline-none motion-safe:transition-[border-color,box-shadow] placeholder:text-muted-foreground/80 hover:border-border-strong focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35 aria-invalid:border-remove disabled:opacity-45 pointer-coarse:min-h-11 sm:text-[13px]",
        className,
      )}
      {...props}
    />
  );
}

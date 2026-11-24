import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent px-3 text-[13px] font-medium outline-none motion-safe:transition-[color,background-color,border-color,box-shadow,transform] motion-safe:duration-120 motion-safe:active:scale-[0.985] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35 disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border-primary bg-primary text-primary-foreground shadow-2xs hover:bg-[color-mix(in_oklab,var(--primary)_88%,var(--background))]",
        outline:
          "border-border bg-card text-foreground shadow-2xs hover:border-border-strong hover:bg-surface-subtle",
        subtle:
          "border-transparent bg-muted text-foreground hover:bg-[color-mix(in_oklab,var(--muted)_85%,var(--foreground))]",
        ghost:
          "text-muted-foreground hover:bg-muted hover:text-foreground",
        danger:
          "border-remove/25 bg-remove-tint text-remove hover:bg-[color-mix(in_oklab,var(--rem-bg)_80%,var(--rem-fg))]",
        link:
          "px-0 text-signal underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        default: "min-h-9 px-3.5 pointer-coarse:min-h-11",
        sm: "min-h-8 px-2.5 pointer-coarse:min-h-11",
        xs: "min-h-7 px-2 text-xs pointer-coarse:min-h-11",
        icon: "size-8 px-0 pointer-coarse:size-11",
        "icon-xs": "size-7 px-0 pointer-coarse:size-11",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Button({
  className,
  variant,
  size,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

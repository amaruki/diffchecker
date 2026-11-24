import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cn } from "@/lib/utils";

export function Tabs(props: TabsPrimitive.Root.Props) {
  return <TabsPrimitive.Root data-slot="tabs" {...props} />;
}

export function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn("inline-flex min-w-0 items-center rounded-lg border border-border/70 bg-muted p-0.5", className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex min-h-8 min-w-0 flex-1 select-none items-center justify-center gap-1.5 rounded-[6px] px-3 text-[13px] font-medium whitespace-nowrap text-muted-foreground outline-none motion-safe:transition-[color,background-color,box-shadow] motion-safe:duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 aria-selected:bg-card aria-selected:text-foreground aria-selected:shadow-2xs pointer-coarse:min-h-10 [&_svg]:size-3.5 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent(props: TabsPrimitive.Panel.Props) {
  return <TabsPrimitive.Panel data-slot="tabs-content" {...props} />;
}

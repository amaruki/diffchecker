import { Badge } from "@/components/ui/badge";
import { useId, type ReactNode } from "react";
import { ChevronDownIcon, SlidersHorizontalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { FieldGroup, FieldLabel } from "@/components/ui/field";
import { panel } from "./styles";

interface ComparisonToolbarProps {
  children: ReactNode;
  actions: ReactNode;
  filter: ReactNode;
  customized: boolean;
  /** Optional expandable sub-row or inline status message below the main toolbar row. */
  subrow?: ReactNode;
}

export function ComparisonToolbar({ children, actions, filter, customized, subrow }: ComparisonToolbarProps) {
  return (
    <Collapsible className={`${panel} px-2.5 py-1.5`} role="region" aria-label="Comparison controls">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        {filter && <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">{filter}</div>}
        <CollapsibleTrigger
          render={<Button variant="ghost" size="sm" />}
          className="group/settings text-foreground"
        >
          <SlidersHorizontalIcon className="text-muted-foreground" aria-hidden />
          Settings
          {customized && <Badge tone="accent">Custom</Badge>}
          <ChevronDownIcon className="text-muted-foreground motion-safe:transition-transform group-data-panel-open/settings:rotate-180" aria-hidden />
        </CollapsibleTrigger>
        <div className="ml-auto flex flex-wrap items-center gap-1.5 max-sm:ml-0">{actions}</div>
      </div>
      {subrow}
      <CollapsibleContent keepMounted>
        <FieldGroup className="mt-2 grid items-start gap-4 border-t border-border px-1 pt-3.5 pb-2 sm:grid-cols-2 lg:grid-cols-3">
          {children}
        </FieldGroup>
      </CollapsibleContent>
    </Collapsible>
  );
}

interface ComparisonCheckboxProps {
  children: ReactNode;
  checked: boolean;
  onChange: (value: boolean) => void;
}

export function ComparisonCheckbox({ children, checked, onChange }: ComparisonCheckboxProps) {
  const id = useId();
  return (
    <div className="flex min-h-8 items-center gap-2 pointer-coarse:min-h-10">
      <Checkbox id={id} checked={checked} onCheckedChange={onChange} />
      <FieldLabel htmlFor={id} className="flex min-h-8 flex-1 cursor-pointer select-none items-center text-[13px] font-normal text-foreground pointer-coarse:min-h-10">
        {children}
      </FieldLabel>
    </div>
  );
}

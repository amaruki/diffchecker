import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { DEFAULT_TEXT_OPTIONS, type TextDiffOptions, type TextFormat, type TextFormatOption } from "../../text/types";
import { ComparisonCheckbox, ComparisonToolbar } from "../ComparisonToolbar";

interface TextOptionsBarProps {
  options: TextDiffOptions;
  onChange: (next: TextDiffOptions) => void;
  resolved: TextFormat | null;
  showFilter: boolean;
  onlyChanges: boolean;
  onOnlyChangesChange: (value: boolean) => void;
  actions: ReactNode;
  subrow?: ReactNode;
}

const FORMAT_LABELS: Record<TextFormatOption, string> = {
  auto: "Detect automatically",
  json: "JSON",
  text: "Plain text",
};

export function TextOptionsBar({
  options,
  onChange,
  resolved,
  showFilter,
  onlyChanges,
  onOnlyChangesChange,
  actions,
  subrow,
}: TextOptionsBarProps) {
  const set = <K extends keyof TextDiffOptions>(key: K, value: TextDiffOptions[K]) => onChange({ ...options, [key]: value });
  const format = options.format === "auto" ? resolved : options.format;
  const customized =
    options.format !== DEFAULT_TEXT_OPTIONS.format ||
    options.sortKeys !== DEFAULT_TEXT_OPTIONS.sortKeys ||
    options.ignoreWhitespace ||
    options.ignoreCase ||
    options.ignoreBlankLines;

  return (
    <ComparisonToolbar
      customized={customized}
      actions={actions}
      subrow={subrow}
      filter={
        <>
          {showFilter && (
            <ComparisonCheckbox checked={onlyChanges} onChange={onOnlyChangesChange}>
              Only changed lines
            </ComparisonCheckbox>
          )}
          {resolved && <Badge tone="neutral">{FORMAT_LABELS[resolved]}</Badge>}
        </>
      }
    >
      <Field>
        <FieldLabel htmlFor="text-format">Input format</FieldLabel>
        <NativeSelect id="text-format" value={options.format} onChange={(e) => set("format", e.currentTarget.value as TextFormatOption)}>
          {(Object.keys(FORMAT_LABELS) as TextFormatOption[]).map((value) => (
            <NativeSelectOption key={value} value={value}>
              {FORMAT_LABELS[value]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <FieldDescription>Use plain text to include JSON formatting in the comparison.</FieldDescription>
      </Field>
      {format !== "text" && (
        <FieldSet>
          <FieldLegend>JSON rules</FieldLegend>
          <ComparisonCheckbox checked={options.sortKeys} onChange={(value) => set("sortKeys", value)}>
            Ignore key order
          </ComparisonCheckbox>
        </FieldSet>
      )}
      {format !== "json" && (
        <FieldSet>
          <FieldLegend>Plain text rules</FieldLegend>
          <ComparisonCheckbox checked={options.ignoreWhitespace} onChange={(value) => set("ignoreWhitespace", value)}>
            Ignore whitespace
          </ComparisonCheckbox>
          <ComparisonCheckbox checked={options.ignoreCase} onChange={(value) => set("ignoreCase", value)}>
            Ignore letter case
          </ComparisonCheckbox>
          <ComparisonCheckbox checked={options.ignoreBlankLines} onChange={(value) => set("ignoreBlankLines", value)}>
            Ignore blank lines
          </ComparisonCheckbox>
        </FieldSet>
      )}
    </ComparisonToolbar>
  );
}

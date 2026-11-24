import { useEffect, useState, type ReactNode } from "react";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { DEFAULT_OPTIONS, type CompareMode, type DiffOptions, type RowMatching } from "../core/types";
import { columnName, parseColumnName } from "./columns";
import { ComparisonCheckbox, ComparisonToolbar } from "./ComparisonToolbar";

interface OptionsBarProps {
  options: DiffOptions;
  onChange: (next: DiffOptions) => void;
  showFilter: boolean;
  onlyDiffs: boolean;
  onOnlyDiffsChange: (value: boolean) => void;
  actions: ReactNode;
  subrow?: ReactNode;
}

const MATCHING_LABELS: Record<RowMatching, string> = {
  aligned: "Detect inserted and deleted rows",
  index: "Use the same row numbers",
  key: "Use a key column",
};

export function OptionsBar({ options, onChange, showFilter, onlyDiffs, onOnlyDiffsChange, actions, subrow }: OptionsBarProps) {
  const [keyText, setKeyText] = useState(columnName(options.keyColumn));
  useEffect(() => setKeyText(columnName(options.keyColumn)), [options.keyColumn, options.rowMatching]);
  const keyValid = parseColumnName(keyText) !== null;
  const set = <K extends keyof DiffOptions>(key: K, value: DiffOptions[K]) => onChange({ ...options, [key]: value });
  const customized =
    options.rowMatching !== DEFAULT_OPTIONS.rowMatching ||
    options.compareMode !== DEFAULT_OPTIONS.compareMode ||
    options.ignoreCase ||
    options.trimWhitespace ||
    options.ignoreEmpty;

  return (
    <ComparisonToolbar
      customized={customized}
      actions={actions}
      subrow={subrow}
      filter={
        showFilter && (
          <ComparisonCheckbox checked={onlyDiffs} onChange={onOnlyDiffsChange}>
            Only changed rows
          </ComparisonCheckbox>
        )
      }
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="row-matching">Match rows</FieldLabel>
          <NativeSelect id="row-matching" value={options.rowMatching} onChange={(e) => set("rowMatching", e.currentTarget.value as RowMatching)}>
            {(Object.keys(MATCHING_LABELS) as RowMatching[]).map((mode) => (
              <NativeSelectOption key={mode} value={mode}>
                {MATCHING_LABELS[mode]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        {options.rowMatching === "key" && (
          <Field data-invalid={!keyValid || undefined}>
            <FieldLabel htmlFor="key-column">Key column</FieldLabel>
            <Input
              id="key-column"
              className="max-w-24 font-mono uppercase"
              value={keyText}
              maxLength={3}
              spellCheck={false}
              aria-invalid={!keyValid}
              aria-describedby={keyValid ? "key-column-hint" : "key-column-error"}
              onChange={(e) => {
                const text = e.currentTarget.value;
                setKeyText(text);
                const col = parseColumnName(text);
                if (col !== null) set("keyColumn", col);
              }}
            />
            {keyValid ? (
              <FieldDescription id="key-column-hint">Column that identifies each row, such as an ID column.</FieldDescription>
            ) : (
              <FieldError id="key-column-error">Enter a column between A and XFD.</FieldError>
            )}
          </Field>
        )}
      </FieldGroup>
      <Field>
        <FieldLabel htmlFor="compare-cells">Compare cells by</FieldLabel>
        <NativeSelect id="compare-cells" value={options.compareMode} onChange={(e) => set("compareMode", e.currentTarget.value as CompareMode)}>
          <NativeSelectOption value="values">Computed values</NativeSelectOption>
          <NativeSelectOption value="formulas">Formulas</NativeSelectOption>
        </NativeSelect>
        <FieldDescription>Choose formulas to catch edits that produce the same value.</FieldDescription>
      </Field>
      <FieldSet>
        <FieldLegend>Ignore differences in</FieldLegend>
        <ComparisonCheckbox checked={options.ignoreCase} onChange={(value) => set("ignoreCase", value)}>
          Letter case
        </ComparisonCheckbox>
        <ComparisonCheckbox checked={options.trimWhitespace} onChange={(value) => set("trimWhitespace", value)}>
          Leading and trailing spaces
        </ComparisonCheckbox>
        <ComparisonCheckbox checked={options.ignoreEmpty} onChange={(value) => set("ignoreEmpty", value)}>
          Empty cells
        </ComparisonCheckbox>
      </FieldSet>
    </ComparisonToolbar>
  );
}

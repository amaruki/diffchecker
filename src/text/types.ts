/**
 * Data shapes for the text / JSON diff. Everything must survive structuredClone.
 */
import type { RowStatus } from "../core/types";

/** auto = JSON when every non-empty side looks like JSON, else plain text. */
export type TextFormatOption = "auto" | "json" | "text";
export type TextFormat = "json" | "text";

export interface TextDiffOptions {
  format: TextFormatOption;
  /** JSON only: compare objects regardless of key order (keys are printed sorted). */
  sortKeys: boolean;
  /** Text only: trim lines and collapse runs of whitespace. */
  ignoreWhitespace: boolean;
  /** Text only. */
  ignoreCase: boolean;
  /** Text only: blank lines take no part in alignment and never count as differences. */
  ignoreBlankLines: boolean;
}

export const DEFAULT_TEXT_OPTIONS: TextDiffOptions = {
  format: "auto",
  sortKeys: true,
  ignoreWhitespace: false,
  ignoreCase: false,
  ignoreBlankLines: false,
};

export interface TextInput {
  /** File name, or null for pasted text. Used for format detection. */
  name: string | null;
  text: string;
}

/** Highlight range [start, end) in character offsets of one line. */
export type Range = [number, number];

/**
 * One line of the side-by-side view. orig / mod index into TextDiff.left / right,
 * or -1 when the line exists on one side only. A one-sided "same" row is a blank
 * line skipped by ignoreBlankLines.
 */
export interface AlignedLine {
  orig: number;
  mod: number;
  status: RowStatus;
  /** Changed rows only: word-level differences on each side. */
  hlOrig?: Range[];
  hlMod?: Range[];
}

export interface TextCounts {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
}

export type JsonChangeKind = "added" | "removed" | "changed" | "type";

export interface JsonChange {
  kind: JsonChangeKind;
  /** JSONPath-like location in each document; null on the side where it does not exist. */
  origPath: string | null;
  modPath: string | null;
  /** Compact JSON of the old / new value, truncated for display. */
  oldValue?: string;
  newValue?: string;
  /** Line index in the printed document where the value starts, or -1. */
  origLine: number;
  modLine: number;
}

export interface TextNote {
  level: "info" | "warning";
  message: string;
}

export interface TextDiff {
  format: TextFormat;
  notes: TextNote[];
  /** Lines as displayed (pretty-printed for JSON). */
  left: string[];
  right: string[];
  rows: AlignedLine[];
  counts: TextCounts;
  /** No differences under the active options. */
  identical: boolean;
  /** The two input strings are byte-for-byte equal. */
  rawIdentical: boolean;
  /** JSON only. `changes` is capped; `total` is the real count. */
  json: { changes: JsonChange[]; total: number } | null;
}

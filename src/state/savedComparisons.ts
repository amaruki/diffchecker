import type { DiffOptions } from "../core/types";
import type { WorkbookReport } from "../core/workbookReport";
import type { TextDiffOptions, TextInput } from "../text/types";
import { isDiffOptions, isRecord, sanitizeDiffOptions } from "./reportEncoding";
import {
  deleteWorkbookSnapshot,
  listWorkbookHistory,
  readWorkbookSnapshot,
  WORKBOOK_KEY_PREFIX,
  writeWorkbookSnapshot,
} from "./workbookHistory";

interface LegacyWorkbook {
  name: string;
  base64: string;
}

interface WorkbookSettings {
  mode: "sheet";
  options: DiffOptions;
  onlyDiffs: boolean;
}

export type WorkbookSnapshot = WorkbookSettings & { original: File; modified: File };
export interface WorkbookReportSnapshot {
  mode: "sheet";
  report: WorkbookReport;
}
export type SavedWorkbookSnapshot = WorkbookSnapshot | WorkbookReportSnapshot;
type TextSnapshot = { mode: "text"; original: TextInput; modified: TextInput; options: TextDiffOptions; onlyChanges: boolean };
type LegacySnapshot = TextSnapshot | (WorkbookSettings & { original: LegacyWorkbook; modified: LegacyWorkbook });
export type ComparisonSnapshot = SavedWorkbookSnapshot | TextSnapshot;

export interface SavedComparison {
  key: string;
  savedAt: number;
  originalName: string;
  modifiedName: string;
  kind?: "result" | "sources";
}

type Mode = ComparisonSnapshot["mode"];

export const SAVED_COMPARISON_PREFIX = "diffcheck:comparison:v1:";
const modePrefix = (mode: Mode) => SAVED_COMPARISON_PREFIX + mode + ":";

function createId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return crypto.getRandomValues(new Uint32Array(4)).join("-");
}

function isWorkbook(value: unknown): value is LegacyWorkbook {
  return isRecord(value) && typeof value.name === "string" && typeof value.base64 === "string";
}

function isText(value: unknown): value is TextInput {
  return isRecord(value) && (value.name === null || typeof value.name === "string") && typeof value.text === "string";
}

function parseLegacySnapshot(value: unknown): LegacySnapshot | null {
  if (!isRecord(value) || !isRecord(value.options)) return null;
  const { options } = value;
  if (value.mode === "sheet") {
    if (!isWorkbook(value.original) || !isWorkbook(value.modified) || typeof value.onlyDiffs !== "boolean" || !isDiffOptions(options)) {
      return null;
    }
    return {
      mode: "sheet",
      original: { name: value.original.name, base64: value.original.base64 },
      modified: { name: value.modified.name, base64: value.modified.base64 },
      options: sanitizeDiffOptions(options),
      onlyDiffs: value.onlyDiffs,
    };
  }
  if (
    value.mode === "text" &&
    isText(value.original) &&
    isText(value.modified) &&
    typeof value.onlyChanges === "boolean" &&
    (options.format === "auto" || options.format === "json" || options.format === "text") &&
    typeof options.sortKeys === "boolean" &&
    typeof options.ignoreWhitespace === "boolean" &&
    typeof options.ignoreCase === "boolean" &&
    typeof options.ignoreBlankLines === "boolean"
  ) {
    return {
      mode: "text",
      original: { name: value.original.name, text: value.original.text },
      modified: { name: value.modified.name, text: value.modified.text },
      options: {
        format: options.format,
        sortKeys: options.sortKeys,
        ignoreWhitespace: options.ignoreWhitespace,
        ignoreCase: options.ignoreCase,
        ignoreBlankLines: options.ignoreBlankLines,
      },
      onlyChanges: value.onlyChanges,
    };
  }
  return null;
}

export function listLegacyComparisons(storage: Storage, mode: Mode): SavedComparison[] {
  const entries: SavedComparison[] = [];
  const prefix = modePrefix(mode);
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(prefix)) continue;
    const value = storage.getItem(key);
    if (value === null) continue;
    try {
      const entry: unknown = JSON.parse(value);
      const snapshot = isRecord(entry) ? parseLegacySnapshot(entry.snapshot) : null;
      if (
        isRecord(entry) &&
        typeof entry.savedAt === "number" &&
        Number.isFinite(new Date(entry.savedAt).getTime()) &&
        snapshot &&
        snapshot.mode === mode
      ) {
        entries.push({
          key,
          savedAt: entry.savedAt,
          originalName: snapshot.original.name ?? "Pasted text",
          modifiedName: snapshot.modified.name ?? "Pasted text",
        });
        continue;
      }
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    // Keep unreadable entries visible so users can remove them and recover the space.
    entries.push({ key, savedAt: 0, originalName: "Unreadable comparison", modifiedName: "" });
  }
  return entries;
}

export async function listSavedComparisons(mode: Mode): Promise<SavedComparison[]> {
  if (mode === "text") {
    return listLegacyComparisons(window.localStorage, mode).sort((a, b) => b.savedAt - a.savedAt);
  }
  // Isolate legacy localStorage reads from IndexedDB so a blocked localStorage does not break workbook history.
  let legacy: SavedComparison[] = [];
  let legacyError: unknown = null;
  try {
    legacy = listLegacyComparisons(window.localStorage, mode);
  } catch (error) {
    legacyError = error;
  }
  try {
    const workbookEntries = await listWorkbookHistory();
    return [...legacy, ...workbookEntries].sort((a, b) => b.savedAt - a.savedAt);
  } catch (idbError) {
    if (legacy.length > 0) return legacy.sort((a, b) => b.savedAt - a.savedAt);
    throw idbError ?? legacyError;
  }
}

export async function saveComparison(snapshot: ComparisonSnapshot): Promise<SavedComparison> {
  const id = createId();
  const entry: SavedComparison = {
    key: (snapshot.mode === "sheet" ? WORKBOOK_KEY_PREFIX : modePrefix("text")) + id,
    savedAt: Date.now(),
    originalName: "report" in snapshot ? snapshot.report.originalName : (snapshot.original.name ?? "Pasted text"),
    modifiedName: "report" in snapshot ? snapshot.report.modifiedName : (snapshot.modified.name ?? "Pasted text"),
  };
  if (snapshot.mode === "sheet") {
    entry.kind = "report" in snapshot ? "result" : "sources";
    await writeWorkbookSnapshot(entry, snapshot);
  } else {
    window.localStorage.setItem(entry.key, JSON.stringify({ savedAt: entry.savedAt, snapshot }));
  }
  return entry;
}

export function readLegacyComparison(storage: Storage, mode: Mode, key: string): LegacySnapshot {
  const raw = key.startsWith(modePrefix(mode)) ? storage.getItem(key) : null;
  if (raw === null) throw new Error("This saved comparison is no longer available.");
  let entry: unknown;
  try {
    entry = JSON.parse(raw);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error("This saved comparison is unreadable.", { cause: error });
  }
  const snapshot = isRecord(entry) ? parseLegacySnapshot(entry.snapshot) : null;
  if (!snapshot || snapshot.mode !== mode) {
    throw new Error("This saved comparison is unreadable.");
  }
  return snapshot;
}

export async function openSavedComparison(mode: Mode, key: string): Promise<ComparisonSnapshot> {
  if (mode === "sheet" && key.startsWith(WORKBOOK_KEY_PREFIX)) {
    const snapshot = await readWorkbookSnapshot(key);
    if (!snapshot) throw new Error("This saved comparison is no longer available.");
    return snapshot;
  }
  const snapshot = readLegacyComparison(window.localStorage, mode, key);
  if (snapshot.mode === "text") return snapshot;
  return { ...snapshot, original: decodeWorkbook(snapshot.original), modified: decodeWorkbook(snapshot.modified) };
}

export async function deleteSavedComparison(mode: Mode, key: string): Promise<void> {
  if (mode === "sheet" && key.startsWith(WORKBOOK_KEY_PREFIX)) {
    await deleteWorkbookSnapshot(key);
  } else if (key.startsWith(modePrefix(mode))) {
    window.localStorage.removeItem(key);
  }
}

export function decodeWorkbook(workbook: LegacyWorkbook): File {
  let binary: string;
  try {
    binary = atob(workbook.base64);
  } catch (error) {
    throw new Error(`The saved workbook ${workbook.name} is unreadable.`, { cause: error });
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], workbook.name);
}

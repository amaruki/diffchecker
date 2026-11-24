/**
 * Bundled sample pairs, so a first-time visitor can see a result without their own files.
 * The files come from samples/ and are emitted as build assets (16 KB per workbook).
 */
import modifiedJson from "../../samples/modified.json?raw";
import modifiedTxt from "../../samples/modified.txt?raw";
import modifiedXlsxUrl from "../../samples/modified.xlsx?url";
import originalJson from "../../samples/original.json?raw";
import originalTxt from "../../samples/original.txt?raw";
import originalXlsxUrl from "../../samples/original.xlsx?url";

export interface SamplePair {
  original: File;
  modified: File;
}

export type TextSampleKind = "json" | "text";

const TEXT_SAMPLES: Record<TextSampleKind, { names: [string, string]; texts: [string, string] }> = {
  json: { names: ["original.json", "modified.json"], texts: [originalJson, modifiedJson] },
  text: { names: ["original.txt", "modified.txt"], texts: [originalTxt, modifiedTxt] },
};

export function textSample(kind: TextSampleKind): SamplePair {
  const { names, texts } = TEXT_SAMPLES[kind];
  return { original: new File([texts[0]], names[0]), modified: new File([texts[1]], names[1]) };
}

async function fetchFile(url: string, name: string): Promise<File> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load the sample file ${name} (HTTP ${res.status}).`);
  return new File([await res.arrayBuffer()], name);
}

/** Throws when the bundled sample cannot be fetched; the caller shows the message. */
export async function spreadsheetSample(): Promise<SamplePair> {
  const [original, modified] = await Promise.all([fetchFile(originalXlsxUrl, "original.xlsx"), fetchFile(modifiedXlsxUrl, "modified.xlsx")]);
  return { original, modified };
}

import type { PackedTextDiff } from "../text/pack";
import type { TextDiffOptions, TextInput } from "../text/types";

/** Main thread → text worker. The main thread ignores responses with a stale id. */
export type TextWorkerRequest = { type: "diff"; id: number; original: TextInput; modified: TextInput; options: TextDiffOptions };

/** Text worker → main thread. */
export type TextWorkerResponse =
  | { type: "diffed"; id: number; diff: PackedTextDiff; diffMs: number }
  | { type: "diff-error"; id: number; message: string };

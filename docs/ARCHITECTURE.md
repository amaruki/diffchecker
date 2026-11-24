# Architecture & Technical Reference

This document details the internal design, worker communication model, state machines, security boundaries, benchmarks, and known technical debt of **Diffcheck**.

## Module Layout

```text
src/core/      Pure spreadsheet logic, no DOM: parse (SheetJS), normalize, hash, align, diffSheet, diffWorkbook, pack, workbookReport
src/text/      Pure text & JSON logic: lines, inline (word diff), json, diffText, pack, decode, view
src/worker/    Web Workers (diff.worker.ts, text.worker.ts); typed protocols; main-thread clients
src/state/     Explicit state machines (machine.ts, textMachine.ts) and browser persistence (IndexedDB / localStorage / gzip report encoding)
src/ui/        Spreadsheet UI components, plus navigation.ts and scrollSync.ts shared by both modes
src/ui/text/   Text & JSON UI: TextMode, TextInputPanel, TextOptionsBar, TextDiffView, TextPane
src/App.tsx    Shell with mode tabs; both modes stay mounted so switching modes preserves loaded files
tests/         Bun test suites
scripts/       Sample generator (make-samples.ts) and headless Chromium smoke test (smoke-test.ts)
```

## Core Design Principles

- **The worker owns parsing and diffing.** Each mode delegates heavy parsing and diff computation to a dedicated Web Worker (`src/worker/diff.worker.ts` and `src/worker/text.worker.ts`). In spreadsheet mode, the worker keeps the parsed workbooks in memory so changing comparison options re-runs only the diff.
- **Zero-copy packed transfer.** `structuredClone` of 600k cell objects takes ~2 s in V8 (roughly half on the main thread). Instead, the worker packs sheets and diff results into typed arrays (transferred zero-copy) plus one concatenated string per field (`src/core/pack.ts`).
- **Hash-based row & line alignment.** Each row/line receives a normalized signature and a 53-bit hash (`cyrb53` in `src/core/hash.ts`). Alignment (`src/core/align.ts`) uses hash maps and a longest-increasing-subsequence (patience diff) pass rather than quadratic nested loops. Equal hashes are confirmed by comparing signatures, so hash collisions cannot hide differences.
- **Virtualized panes.** `@tanstack/react-virtual` virtualizes rows and columns in both panes (`DiffGrid` and `TextPane`), keeping scroll interactions responsive on large files.

## State Machines

### Spreadsheet Mode (`src/state/machine.ts`)

File slots (`Original` and `Modified` each have one). States: `empty`, `parsing`, `ready`, `failed`.

| From | Event | Actor | Guard | To |
|---|---|---|---|---|
| any | `FILE_SELECTED` | user | none | `parsing` |
| any | `FILE_REJECTED` | app (extension check, read error) | none | `failed` |
| `parsing` | `PARSE_SUCCEEDED` | worker | request id matches | `ready` |
| `parsing` | `PARSE_FAILED` | worker | request id matches | `failed` |
| `parsing`, `ready`, `failed` | `FILE_CLEARED` | user | none | `empty` |
| slot pair | `SWAPPED` | user | neither slot `parsing`; at least one slot not `empty` | slots exchanged (worker swaps its copies in the same order) |

Comparison states: `idle`, `running`, `done`, `failed`.

| From | Event | Actor | Guard | To |
|---|---|---|---|---|
| any | `DIFF_STARTED` | app | both slots `ready` | `running` |
| `running` | `DIFF_SUCCEEDED` | worker | request id matches | `done` |
| `running` | `DIFF_FAILED` | worker | request id matches | `failed` |
| any | a slot leaves `ready`, or `SWAPPED` | app | none | `idle` |

There are no terminal states. The machine rejects every other transition, including stale worker responses. See `src/state/machine.ts` and `tests/machine.test.ts`.

### Text & JSON Mode (`src/state/textMachine.ts`)

Text slots (one per side). States: `empty`, `reading`, `ready`, `failed`.

| From | Event | Actor | Guard | To |
|---|---|---|---|---|
| any | `TEXT_EDITED` | user | text is not empty | `ready` (keeps the file name) |
| any | `TEXT_EDITED` | user | text is empty | `empty` |
| any | `FILE_SELECTED` | user | none | `reading` |
| `reading` | `FILE_READ_SUCCEEDED` | file reader | request id matches | `ready` |
| `reading` | `FILE_READ_FAILED` | file reader | request id matches | `failed` |
| `reading`, `ready`, `failed` | `CLEARED` | user | none | `empty` |
| both slots | `SWAPPED` | user | no slot `reading` | slots exchanged |
| any | `RESTORED` | user | a valid saved text comparison was opened | both slots `ready`, comparison `idle` |

Comparison states: `idle`, `running` (keeps the previous result on screen, dimmed), `done`, `failed`.

| From | Event | Actor | Guard | To |
|---|---|---|---|---|
| any | `DIFF_STARTED` | app (250 ms after the last change) | both slots `ready` | `running` |
| `running` | `DIFF_SUCCEEDED` | worker | request id matches | `done` |
| `running` | `DIFF_FAILED` | worker | request id matches | `failed` |
| any | a slot change makes the guard false | app | none | `idle` |

No terminal states. `transitionText` returns `null` for every other transition. See `src/state/textMachine.ts` and `tests/textMachine.test.ts`.

## Security & Hardening Model

- **Strict Content Security Policy (`vite.config.ts`):**
  - Production builds inject a `<meta http-equiv="Content-Security-Policy">` tag into `dist/index.html` enforcing `default-src 'self'`, `script-src 'self'`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' data:`, `font-src 'self'`, `worker-src 'self'`, `connect-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`.
  - Dedicated Web Workers do not inherit HTML `<meta>` CSP tags; static hosts should serve all assets (including `/assets/*.worker-*.js`) with the HTTP `Content-Security-Policy` (plus `frame-ancestors 'none'`) and `X-Frame-Options: DENY` headers configured in `vite.config.ts`.
- **Parser & Input Defenses (`tests/hardening.test.ts`):**
  - Pre-flight Central Directory checks on `.xlsx`/`.xlsm` ZIP buffers reject decompression bombs, non-OOXML ZIPs missing `[Content_Types].xml`, and oversized buffers before SheetJS runs.
  - Alignment scan budgets guard against `O(N^2)` edge-peeling inputs.
  - JSON parsing enforces a maximum nesting depth (`MAX_JSON_DEPTH`) without overflowing the call stack and falls back cleanly to plain text.
  - Text decoding rejects binary files (NUL bytes in the first 8,000 bytes), files over 100 MB, UTF-32 BOMs, and UTF-16 binary NUL code units.
  - Saved workbook report decompression aborts oversized gzip streams incrementally before memory exhaustion and validates decoded objects against prototype-pollution keys (`__proto__`).

## Measured Performance

Spreadsheet mode (50,000 × 12 sample pair, production build, Chrome):

| Step | Time | Thread |
|---|---|---|
| Parse one file (SheetJS) | 12–16 s | worker |
| Diff (aligned mode) | 1.4–2.1 s | worker |
| Longest main-thread task while loading | 143 ms | main |
| Scroll jumps through the grid | no tasks over 50 ms | main |

Text & JSON mode (measured with `bun`; same engine runs in the worker):

| Input | Time |
|---|---|
| Sample JSON pair (55 printed lines) | 21 ms in the browser |
| 200,000-line text, 500 edited lines, 1 inserted line | 1.2–2.5 s |
| JSON array of 50,000 objects (450,000 printed lines), 1 edit, 1 removal | 3.3–5.5 s |

## Known Limitations & Technical Debt

### Spreadsheet Mode

- **Parse time.** SheetJS takes 12–16 s per 50k-row file, and one worker parses both files sequentially. *Future:* use one worker per side, or switch to a streaming XML parser.
- **No cancellation.** When options change during a diff, the worker finishes the stale diff before starting the new one, and the main thread drops the stale result. *Future:* run the diff in chunks with a cancellation check, or terminate and recreate the worker.
- **Signatures are not cached.** Changing only the row-matching mode recomputes every row signature (~0.5 s per 50k-row side). *Future:* cache signatures per normalization-options key.
- **Columns align by position.** An inserted column shows as a change in every row. *Future:* add header-based column matching.
- **Single key column.** Composite keys are not supported.
- **Large regions without anchors.** When more than 1,000,000 row pairs (`rows × rows`) share no unique row, those rows pair by position instead of an exact LCS.
- **Large merged ranges.** Ranges with more than 100,000 cells are compared, but their covered cells are not dotted in the grid.
- **Memory.** The main thread holds a packed copy of both workbooks, and the worker holds the object model.
- **Sheet types.** Only `.xlsx` and `.xlsm` are accepted. Chart sheets appear as empty sheets.

### Text & JSON Mode

- **Other structured formats.** XML, YAML, CSV, and other formats are compared as plain text; only JSON has a structural diff. *Future:* add parsers per format producing the same `JsonValue` tree.
- **Large JSON numbers.** `JSON.parse` reads numbers as IEEE 754 doubles, so integers beyond `2^53` and long decimals lose precision and can compare as equal. *Future:* parse with a lossless number reviver.
- **Two alignments.** The line view and the structural change list align separately; a reordered array can show different pairings in the two views. *Future:* derive the printed-line alignment from the structural alignment.
- **No incremental diff.** Each edit sends both full texts to the worker and recomputes everything (3–5 s per edit on 450k-line JSON). *Future:* cache parsed and printed sides by text.
- **No cancellation.** Same as spreadsheet mode: a stale diff runs to completion before the next one starts.
- **Gap pairing limits.** Gaps with more than 10,000 line pairs (4,096 for array elements) pair by position.
- **Long lines & large edits.** Lines are compared in full but rendered up to 4,000 characters; inputs over 1,000,000 characters are compared but not editable in the input box.
- **Encoding.** Only UTF-8 and BOM-marked UTF-16 are detected. Legacy encodings (Latin-1, Shift-JIS) decode with replacement characters.

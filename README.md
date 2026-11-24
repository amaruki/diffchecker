# Diffcheck

[![CI](https://github.com/amaruki/diffchecker/actions/workflows/ci.yml/badge.svg)](https://github.com/amaruki/diffchecker/actions/workflows/ci.yml)
[![Live App](docs/badges/live.svg)](https://diffchecker.amaruki.my.id)
[![License: MIT](docs/badges/license-mit.svg)](LICENSE)
[![Bun](docs/badges/bun.svg)](https://bun.sh)
[![React 19](docs/badges/react.svg)](https://react.dev)
[![TypeScript](docs/badges/typescript.svg)](https://www.typescriptlang.org)
[![Privacy](docs/badges/local-only.svg)](#privacy--security)

**Privacy-first, local-only browser diff tool for Excel spreadsheets (`.xlsx`/`.xlsm`), plain text, and JSON.**

> **Try it live:** **[diffchecker.amaruki.my.id](https://diffchecker.amaruki.my.id)** ([Spreadsheet](https://diffchecker.amaruki.my.id) · [Text & JSON](https://diffchecker.amaruki.my.id/#text))

Files are parsed and diffed entirely inside dedicated browser Web Workers—nothing is ever uploaded to a server, and production builds enforce a strict `connect-src 'self'` Content Security Policy.

The URL hash selects the active mode: `/` for **Spreadsheet**, `/#text` for **Text & JSON**.

---

## Features

### Spreadsheet Mode (`.xlsx` / `.xlsm`)

- **Sheet matching & rename detection:** Matches sheets by name, detects renamed sheets when unmatched sheets share ≥ 50% identical rows (Jaccard similarity of row hashes), and reports added/removed/reordered sheets.
- **Three row-matching strategies:**
  - **Position (detect inserted rows)** *(default)* — uses hash anchors (patience diff) so an inserted or deleted row stays localized without shifting every row below it.
  - **Strict row number** — compares row `N` directly against row `N`.
  - **Key column** — aligns rows by the value in a chosen column so reordered rows do not appear as differences.
- **Granular comparison options:** Ignore case, trim whitespace, ignore empty cells, and switch between **computed values** and **formula text** (`ƒ` marks formula changes).
- **Virtualized side-by-side grid:** Synchronized scrolling powered by `@tanstack/react-virtual`, color-coded statuses (green = added, red = removed, yellow = changed with old value struck through), dotted merged-range cells, and an **"Only rows with differences"** filter.
- **Summary bar & parity view:** Per-sheet and per-type counts (rows, cells, merged ranges) plus a clear **"Matched – no differences found"** state.
- **Actionable errors:** Clear diagnostics for empty files, non-ZIP files (such as CSV renamed to `.xlsx`), legacy `.xls`, password-protected workbooks, and truncated or malformed archives.

### Text & JSON Mode

- **Automatic format detection:** Treats inputs as JSON when the filename ends in `.json` or content starts with `{` or `[`. Invalid JSON falls back cleanly to plain text with a warning naming the side, line, and column.
- **Structural JSON diff:** Pretty-prints JSON with optional key sorting (`Ignore key order`), aligns array elements via hash anchors, and builds a clickable structural path list (e.g. `$.users[1].email`) for added, removed, changed, and type-changed values.
- **Plain text & inline word highlights:** Compares line by line with word-level diffs inside changed lines, options to ignore whitespace, case, or blank lines, and line-ending normalization (`CRLF`/`CR`/`LF`, noted when line endings are the only difference).
- **Context collapsing & live re-diff:** Re-runs automatically 250 ms after edits; **"Only changed lines"** keeps 3 lines of context around each change.
- **Safety checks:** Rejects files over 100 MB, binary files (NUL bytes), and unsupported encodings; supports UTF-8 and BOM-marked UTF-16.

### UX, Saved Comparisons & Navigation

- **Stage-aware layout:** Drop zones / editors fill the viewport when empty and collapse into compact strips once results appear. Includes built-in sample loaders on both modes.
- **Frictionless swapping & batch drops:** Drop two files at once anywhere on the page to load both sides (`Original` and `Modified`), drop one file onto either half, use **New comparison…** to pick both workbooks at once, or click **⇄ Swap** to flip sides without reloading.
- **Change ruler:** Interactive overview strip beside the panes showing added/removed/changed rows and the current viewport window—click or drag to jump.
- **Saved comparisons in the browser:**
  - **Spreadsheet:** **Save result** stores compact read-only reports in IndexedDB (or choose **Save with source files** to reopen workbooks and tweak settings later, with deduplication when Web Crypto is available).
  - **Text & JSON:** **Save comparison** persists both inputs and settings in `localStorage`.
- **Responsive & accessible:** Adapts cleanly on mobile widths (`≤ 900 px`) and supports light, dark, and system themes.

#### Keyboard Shortcuts

| Keys | Action |
|---|---|
| `n` / `j` / `F8` | Jump to next difference |
| `p` / `k` / `Shift+F8` | Jump to previous difference |
| Arrow keys | Navigate cells in the spreadsheet diff grid |

### Privacy & Security

- **100% client-side:** Zero network requests for user files, enforced in production builds via strict CSP (`script-src 'self'`, `connect-src 'self'`, `worker-src 'self'`, `object-src 'none'`).
- **Hardened parsers:** Central Directory ZIP-bomb pre-flight checks for `.xlsx`/`.xlsm`, incremental gzip-bomb stream limits for saved reports, scan budgets for pathological diff inputs, and safe recursion depth caps for deeply nested JSON.

---

## Quick Start

### Requirements

- [Bun](https://bun.sh) `1.4` or later

### Run Locally

```sh
git clone https://github.com/amaruki/diffchecker.git
cd diffchecker
bun install
bun dev
```

Open `http://localhost:5173` in your browser.

### Available Scripts

| Command | Description |
|---|---|
| `bun dev` | Start the Vite development server on `http://localhost:5173` |
| `bun test` | Run the unit and hardening test suite (`bun test`) |
| `bun run typecheck` | Run TypeScript strict type checking (`tsconfig.app.json` + `tsconfig.node.json`) |
| `bun run build` | Typecheck and build the production bundle into `dist/` |
| `bun run preview` | Serve `dist/` locally on `http://localhost:4173` with production security headers |
| `bun run test:smoke` | Build `dist/` and run the headless Chromium end-to-end smoke test (`scripts/smoke-test.ts`) |
| `bun run samples` | Regenerate the bundled demo pairs in `samples/` |
| `bun run samples:large` | Generate 50,000 × 12 benchmark workbooks (`samples/large-*.xlsx`, git-ignored) |

---

## Sample Files

Click **Try sample workbooks** in Spreadsheet mode or **JSON sample** / **Text sample** in Text & JSON mode, or load the files in [`samples/`](samples):

- [`samples/original.xlsx`](samples/original.xlsx) & [`samples/modified.xlsx`](samples/modified.xlsx) — exercises value edits, formula changes, inserted/deleted rows, merged ranges, added/removed/renamed/empty sheets, and reordered sheets. Load `original.xlsx` on both sides to verify the **Matched** state.
- [`samples/original.json`](samples/original.json) & [`samples/modified.json`](samples/modified.json) — reformatted, key-reordered JSON with value, type, array, and key changes.
- [`samples/original.txt`](samples/original.txt) & [`samples/modified.txt`](samples/modified.txt) — CRLF vs LF differences, inserted lines, and inline word changes.

---

## How Comparison Works

| Area | Behavior |
|---|---|
| Numbers | Compared at 15 significant digits (Excel precision), so `0.1 + 0.2` equals `0.3`. |
| Number & date formats | Ignored for equality (underlying values are compared); formatted text is displayed. |
| Types | Number `5` and string `"5"` count as different. |
| Formulas mode | Formula cells compare by formula text; other cells compare by value. |
| Values mode | Cached computed values are compared; rewriting a formula with the same result is not a difference. |
| Merged cells | Merge ranges are compared per sheet and counted as differences; covered cells appear dotted in the grid. |
| Sheet order | Reported in summaries, not treated as a difference. |
| Empty cells | When **Ignore empty cells** is enabled, empty-string cells count as absent and blank rows are skipped before alignment. |
| Text & JSON alignment | Hash anchors (patience diff) align unchanged lines/elements; gaps pair by Dice word similarity (`≥ 0.5`) or equal array entries (`≥ 50%`). |

---

## Architecture & Performance

```text
src/core/      Pure spreadsheet parse, normalize, hash, align, diff, packed transfer, report logic
src/text/      Pure text & JSON line splitting, word diff, structural JSON diff, decoding
src/worker/    Dedicated Web Workers & typed protocols for both modes
src/state/     Explicit state machines & IndexedDB / localStorage persistence
src/ui/        Spreadsheet & Text/JSON React components, scroll sync, keyboard navigation
```

- **50,000 × 12 spreadsheet benchmark** (production build, Chrome): ~12–16 s parse (worker), ~1.4–2.1 s aligned diff (worker), 143 ms max main-thread task while loading, 0 tasks > 50 ms while scrolling.
- **Text & JSON benchmark** (`bun`): 21 ms for the sample JSON in-browser; 1.2–2.5 s for a 200k-line text file; 3.3–5.5 s for a 50k-object JSON array (450k printed lines).

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the complete architecture notes, state-machine transition tables, benchmarks, and known limitations/roadmap.

---

## Deployment & HTTP Security Headers

`bun run build` outputs a static bundle to `dist/` with a strict `<meta http-equiv="Content-Security-Policy">` tag. Because Dedicated Web Workers (`/assets/*.worker-*.js`) only inherit CSP from HTTP response headers (not HTML `<meta>` tags), configure your static host to serve all assets with the headers defined in [`vite.config.ts`](vite.config.ts):

- `Content-Security-Policy`: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; worker-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
- `X-Frame-Options`: `DENY`
- `X-Content-Type-Options`: `nosniff`

---

## Contributing, Security & License

- **Contributing:** See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code conventions, PR checklist, and open improvement ideas.
- **Code of Conduct:** Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
- **Security:** See [SECURITY.md](SECURITY.md) for vulnerability reporting and hardening details.
- **Changelog:** See [CHANGELOG.md](CHANGELOG.md).
- **License:** Licensed under the [MIT License](LICENSE). Bundled fonts (**Inter** and **JetBrains Mono** in [`public/fonts/`](public/fonts)) are licensed under the SIL Open Font License 1.1.

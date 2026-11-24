# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-11-24

### Added

- **Spreadsheet Mode (`.xlsx` / `.xlsm`):** Sheet-by-sheet and cell-by-cell comparison with position-based patience diff, strict row matching, key-column matching, sheet rename detection, formula vs. value comparison, merged range diffing, and virtualized side-by-side grid.
- **Text & JSON Mode:** Line-by-line diff with word-level highlights, automatic JSON detection, key-order-insensitive structural diff with clickable JSON paths, and CRLF/CR/LF normalization.
- **Browser Persistence:** Compact and full-source workbook saves in IndexedDB and text/JSON comparison history in `localStorage`.
- **Navigation & UX:** Interactive change ruler, keyboard diff navigation (`n`/`j`/`F8`, `p`/`k`/`Shift+F8`, arrow keys), multi-file drag-and-drop, side swapping, and light/dark/system themes.
- **Security & Testing:** Strict Content Security Policy for production builds and workers, parser hardening against ZIP/gzip bombs and pathological inputs, unit tests (`bun test`), and headless Chromium smoke test (`bun run test:smoke`).
- **Open-Source Documentation & CI:** Added `LICENSE` (MIT), `README.md`, `docs/ARCHITECTURE.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, GitHub issue/PR templates, and GitHub Actions CI workflow.

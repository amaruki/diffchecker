# Contributing to Diffcheck

Thank you for your interest in contributing to **Diffcheck**!

## Development Setup

### Prerequisites

- [Bun](https://bun.sh) `1.4` or later
- Chromium or Google Chrome (optional locally, required to run the browser smoke test `bun run test:smoke`)

### Getting Started

```sh
git clone https://github.com/amaruki/diffchecker.git
cd diffchecker
bun install
bun dev
```

## Verification Before Opening a PR

Run the full check suite before submitting changes:

```sh
bun run typecheck   # Strict TypeScript checks across app and node configs
bun test            # Unit and hardening test suites
bun run test:smoke  # Production build + headless Chromium E2E & CSP verification
```

If `chromium` or `google-chrome` is not installed locally, `bun run test:smoke` still verifies the `dist/` build and CSP meta tags and skips the browser step (CI runs the full browser smoke test).

## Project Structure & Conventions

- `src/core/` and `src/text/`: Pure, DOM-free comparison and serialization logic. Keep these modules free of browser DOM APIs so they run identically in Web Workers and `bun test`.
- `src/state/`: Explicit finite-state transitions (`machine.ts`, `textMachine.ts`). Invalid transitions return `null` and stale worker responses are rejected by request ID—add tests in `tests/machine.test.ts` or `tests/textMachine.test.ts` if you extend states or events.
- `src/worker/`: Worker entrypoints and typed message protocols. Large spreadsheet payloads use zero-copy transferable typed arrays (`src/core/pack.ts`).
- `src/ui/`: React UI components (`@base-ui/react`, Tailwind CSS v4, `@tanstack/react-virtual`).
- **Strict CSP:** Never add inline `<script>` tags to `index.html` or fetch external network resources at runtime. Keep the app 100% local-only.

## Good Areas for Contributions

Check [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#known-limitations--technical-debt) for documented improvement opportunities, including:

- Parallelizing workbook parsing across two workers or streaming XML parsing
- Cooperative diff cancellation when options change mid-run
- Caching normalized row signatures across matching-mode switches
- Header-based column alignment or composite key-column matching
- Structural diff parsers (e.g. YAML, XML, CSV) producing the existing `JsonValue` tree
- Lossless large-number JSON parsing

## Pull Request Process

1. Fork the repository and create a branch from `main`.
2. Keep changes focused and add/update tests in `tests/` for new behavior or bug fixes.
3. Update `README.md` or `docs/ARCHITECTURE.md` if user-facing behavior or architecture changes.
4. Fill out the Pull Request template and confirm all checks pass.

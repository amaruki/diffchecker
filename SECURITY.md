# Security Policy

## Privacy Guarantee

Diffcheck is designed as a **100% client-side, local-only** application:

- Files opened or pasted into the application are processed entirely in browser memory and dedicated Web Workers.
- No file contents, filenames, or diff statistics are sent over the network.
- Production builds enforce a strict Content Security Policy (`connect-src 'self'`, `script-src 'self'`, `worker-src 'self'`, `object-src 'none'`).

## Built-In Input & Parser Hardening

Because Diffcheck parses untrusted user-supplied `.xlsx`/`.xlsm`, JSON, text, and saved report files locally, the codebase includes defenses tested in `tests/hardening.test.ts`:

- **ZIP & OOXML pre-flight validation:** Checks Central Directory headers before invoking SheetJS to reject decompression bombs, oversized buffers, and non-OOXML archives.
- **Gzip stream limits:** Saved report decompression aborts oversized streams incrementally and rejects malformed payloads or prototype-pollution keys (`__proto__`).
- **JSON nesting cap & scan budgets:** Guards against stack overflows on deeply nested JSON and `O(N^2)` worst-case alignment inputs.
- **Binary & size guards:** Rejects files over 100 MB, binary NUL bytes, and unsupported UTF-32/binary UTF-16 inputs in Text & JSON mode.

## Supported Versions

| Version | Supported |
|---|---|
| `1.x` (`main`) | Yes |

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities (including CSP bypasses, XSS, parser DoS/crash vectors, or prototype pollution).

Instead, report vulnerabilities privately via GitHub Security Advisories:

- https://github.com/amaruki/diffchecker/security/advisories/new

Include as much detail as possible (reproduction steps, affected mode/file type, and browser version) without attaching confidential third-party documents.

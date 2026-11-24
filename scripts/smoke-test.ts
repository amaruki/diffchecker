/**
 * Hermetic end-to-end headless Chromium smoke test against the built production bundle (`dist/`).
 * Verifies:
 *  - Strict production CSP in dist/index.html (no inline scripts) and HTTP CSP on worker scripts
 *  - Zero console errors, zero uncaught exceptions, zero CSP violations
 *  - Theme switcher, Spreadsheet sample diff, Grid keyboard navigation, Settings toggle,
 *    Save -> Saved dialog -> Open report -> Back -> 2-step Delete, and Text/JSON sample diff
 */
import { spawn, type Subprocess } from "bun";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const distHtml = readFileSync("dist/index.html", "utf8");
const decodedHtml = distHtml.replaceAll("&#39;", "'").replaceAll("&apos;", "'");
if (!decodedHtml.includes('http-equiv="Content-Security-Policy"')) {
  throw new Error("dist/index.html is missing the production Content-Security-Policy meta tag.");
}
if (!decodedHtml.includes("script-src 'self'")) {
  throw new Error("dist/index.html CSP must enforce script-src 'self'.");
}
if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(decodedHtml)) {
  throw new Error("dist/index.html contains an inline <script> tag, which violates strict script-src 'self'.");
}

const chromeBin = Bun.which("chromium") ?? Bun.which("google-chrome");
if (!chromeBin) {
  if (process.env.CI) {
    throw new Error("Chromium/Chrome is required for browser smoke tests in CI.");
  }
  console.log("Skipping browser smoke test: neither chromium nor google-chrome found in PATH.");
  process.exit(0);
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        srv.close();
        reject(new Error("Could not allocate an ephemeral port."));
        return;
      }
      const { port } = addr;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForUrl(url: string, timeoutMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return r;
    } catch {}
    await Bun.sleep(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

const errors: string[] = [];

class CDP {
  ws: WebSocket;
  id = 0;
  pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.method === "Runtime.exceptionThrown") {
        errors.push(`Uncaught exception: ${JSON.stringify(msg.params.exceptionDetails)}`);
      }
      if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
        errors.push(`Console error: ${JSON.stringify(msg.params.args)}`);
      }
      if (msg.method === "Log.entryAdded" && msg.params.entry?.level === "error") {
        errors.push(`Browser log error: ${msg.params.entry.text}`);
      }
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
        else p.resolve(msg.result);
      }
    };
  }

  ready() {
    return new Promise<void>((res, rej) => {
      if (this.ws.readyState === WebSocket.OPEN) return res();
      this.ws.onopen = () => res();
      this.ws.onerror = (e) => rej(e);
    });
  }

  send(method: string, params: Record<string, unknown> = {}) {
    const id = ++this.id;
    return new Promise<any>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval<T = unknown>(expression: string): Promise<T> {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result?.value as T;
  }

  async waitFor(predicateJs: string, label: string, timeoutMs = 8_000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.eval<boolean>(`Boolean(${predicateJs})`)) return;
      await Bun.sleep(60);
    }
    throw new Error(`Timed out waiting for: ${label}`);
  }

  async clickRequired(finderJs: string, label: string): Promise<void> {
    await this.waitFor(finderJs, `clickable ${label}`);
    const clicked = await this.eval<boolean>(`(() => { const el = (${finderJs}); if (!el) return false; el.click(); return true; })()`);
    if (!clicked) throw new Error(`Failed to click ${label}`);
  }

  close() {
    this.ws.close();
  }
}

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(`Smoke test assertion failed: ${message}`);
}

let server: Subprocess | null = null;
let chrome: Subprocess | null = null;
let cdp: CDP | null = null;
const profileDir = mkdtempSync(join(tmpdir(), "diffcheck-smoke-"));

try {
  const port = await findFreePort();
  const debugPort = await findFreePort();

  server = spawn(["bun", "--bun", "vite", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const rootRes = await waitForUrl(`http://127.0.0.1:${port}/`);
  assert(
    rootRes.headers.get("content-security-policy")?.includes("script-src 'self'"),
    "Preview server must send Content-Security-Policy HTTP header on document",
  );

  // Verify Dedicated Worker script also receives HTTP CSP header.
  const workerAsset = readdirSync("dist/assets").find((f) => /^diff\.worker-.*\.js$/.test(f));
  assert(workerAsset, "Built diff worker asset must exist in dist/assets");
  const workerRes = await fetch(`http://127.0.0.1:${port}/assets/${workerAsset}`);
  assert(workerRes.ok, "Worker script must be served");
  assert(
    workerRes.headers.get("content-security-policy")?.includes("connect-src 'self'"),
    "Worker script HTTP response must include Content-Security-Policy header",
  );

  chrome = spawn(
    [
      chromeBin,
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${debugPort}`,
      "--window-size=1440,900",
      "about:blank",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`);
  const targets = (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()) as Array<{
    type: string;
    webSocketDebuggerUrl: string;
  }>;
  const pageTarget = targets.find((t) => t.type === "page");
  if (!pageTarget) throw new Error("No Chromium page target available.");

  cdp = new CDP(pageTarget.webSocketDebuggerUrl);
  await cdp.ready();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");

  await cdp.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
  await cdp.waitFor(`document.querySelector('[data-theme-option="dark"]')`, "initial app render");

  // 1. Theme switching
  await cdp.clickRequired(`document.querySelector('[data-theme-option="dark"]')`, "dark theme button");
  assert(await cdp.eval<boolean>(`document.documentElement.classList.contains('dark')`), "Dark theme should activate");
  await cdp.clickRequired(`document.querySelector('[data-theme-option="light"]')`, "light theme button");
  assert(!(await cdp.eval<boolean>(`document.documentElement.classList.contains('dark')`)), "Light theme should deactivate dark class");

  // 2. Load Spreadsheet sample & verify diff renders
  await cdp.clickRequired(
    `[...document.querySelectorAll('button')].find(b => /Try sample workbooks/i.test(b.textContent || ''))`,
    "Try sample workbooks button",
  );
  await cdp.waitFor(`document.body.innerText.includes('3 differences in sheet')`, "spreadsheet diff results");

  // 3. Verify Settings toggle opens & keeps active sheet tab intact on option change
  await cdp.clickRequired(
    `[...document.querySelectorAll('nav[aria-label="Sheets"] button')].find(b => /Customers/i.test(b.textContent || ''))`,
    "Customers sheet tab",
  );
  await cdp.clickRequired(
    `[...document.querySelectorAll('button')].find(b => /Settings/i.test(b.textContent || ''))`,
    "Settings toggle button",
  );
  await cdp.waitFor(`document.querySelector('#compare-cells')`, "Settings panel controls");
  await cdp.eval(`(() => {
    const sel = document.querySelector('#compare-cells');
    sel.value = 'formulas';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await cdp.waitFor(
    `document.querySelector('nav[aria-label="Sheets"] button[aria-current="page"]')?.textContent?.includes('Customers')`,
    "active Customers tab persists across option change",
  );

  // 4. Verify DiffGrid arrow-key navigation advances selection properly (not stuck on row 0)
  await cdp.clickRequired(`document.querySelector('button[aria-label="Next difference"]')`, "Next difference button");
  await cdp.waitFor(`document.querySelector('[data-cell-selected="true"]')`, "selected cell");
  const initialCell = await cdp.eval<string>(
    `(() => { const el = document.querySelector('[data-cell-selected="true"]'); return el.dataset.k + ':' + el.dataset.c; })()`,
  );
  await cdp.eval(`(() => {
    const pane = document.querySelector('[aria-describedby="cell-navigation"]');
    pane.focus();
    pane.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  })()`);
  const afterArrowCell = await cdp.eval<string>(
    `(() => { const el = document.querySelector('[data-cell-selected="true"]'); return el.dataset.k + ':' + el.dataset.c; })()`,
  );
  assert(afterArrowCell !== initialCell, `ArrowRight should move cell selection (stayed on ${initialCell})`);

  // 5. Save result -> open Saved dialog -> open report -> Back -> reopen Saved -> 2-step Delete
  await cdp.clickRequired(
    `[...document.querySelectorAll('button')].find(b => /Save result/i.test(b.textContent || ''))`,
    "Save result button",
  );
  await cdp.waitFor(`document.body.innerText.includes('Result saved in this browser.')`, "save confirmation");
  await cdp.clickRequired(
    `[...document.querySelectorAll('button')].find(b => b.getAttribute('aria-haspopup') === 'dialog')`,
    "Saved history button",
  );
  await cdp.clickRequired(
    `[...document.querySelectorAll('dialog[open] button')].find(b => b.textContent?.trim() === 'Open')`,
    "Open saved result button",
  );
  await cdp.waitFor(`/saved workbook report/i.test(document.body.innerText)`, "Saved workbook report view");
  await cdp.clickRequired(
    `[...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Back')`,
    "Back button",
  );
  await cdp.waitFor(`document.querySelector('nav[aria-label="Sheets"]')`, "return to live spreadsheet diff");

  // Reopen Saved dialog and exercise 2-step Delete confirmation
  await cdp.clickRequired(
    `[...document.querySelectorAll('button')].find(b => b.getAttribute('aria-haspopup') === 'dialog')`,
    "Saved history button for delete",
  );
  await cdp.clickRequired(
    `document.querySelector('dialog[open] button[title="Delete saved comparison"]')`,
    "Delete icon button",
  );
  await cdp.clickRequired(
    `[...document.querySelectorAll('dialog[open] button')].find(b => /Confirm delete/i.test(b.textContent || ''))`,
    "Confirm delete button",
  );
  await cdp.waitFor(
    `document.querySelector('dialog[open]')?.textContent?.includes('No saved comparisons yet')`,
    "empty history after delete",
  );
  await cdp.clickRequired(`document.querySelector('dialog[open] button[aria-label="Close saved comparisons"]')`, "Close dialog button");

  // 6. Switch to Text & JSON mode, load JSON sample, verify structural changes
  await cdp.clickRequired(`document.querySelectorAll('[role="tab"]')[1]`, "Text & JSON tab");
  await cdp.clickRequired(
    `[...document.querySelectorAll('button')].find(b => /JSON sample/i.test(b.textContent || ''))`,
    "JSON sample button",
  );
  await cdp.waitFor(
    `document.body.innerText.includes('Structural changes') && document.body.innerText.includes('9 JSON changes')`,
    "JSON sample structural diff",
  );

  assert(errors.length === 0, `Expected 0 browser errors, got ${errors.length}:\n${errors.join("\n")}`);
  console.log("Smoke test passed: CSP (HTML + Worker), Theme, Spreadsheet, Settings, Grid Nav, Save/Report/Delete, and Text/JSON verified with 0 errors.");
} finally {
  cdp?.close();
  chrome?.kill();
  server?.kill();
  rmSync(profileDir, { recursive: true, force: true });
}

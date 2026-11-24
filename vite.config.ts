import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

/**
 * Strict Content Security Policy for production builds.
 * Keeps `script-src 'self'` (no unsafe-inline) and restricts network connections to `'self'`,
 * reinforcing the privacy guarantee that files never leave the browser.
 *
 * NOTE for production web servers: Dedicated Web Workers (`/assets/*.worker-*.js`) only
 * inherit CSP from HTTP response headers, not from HTML `<meta>` tags. Always serve all
 * assets (including worker JS files) with `Content-Security-Policy: ${HTTP_CSP}` and
 * `X-Frame-Options: DENY`.
 */
const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "worker-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const HTTP_CSP = `${PRODUCTION_CSP}; frame-ancestors 'none'`;

function productionCspPlugin(): Plugin {
  return {
    name: "diffcheck-production-csp",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        if (ctx.server) return html;
        return {
          html,
          tags: [
            {
              tag: "meta",
              attrs: { "http-equiv": "Content-Security-Policy", content: PRODUCTION_CSP },
              injectTo: "head-prepend",
            },
          ],
        };
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), productionCspPlugin()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  worker: { format: "es" },
  build: {
    // Keep `?url` assets (e.g. bundled .xlsx samples) as `'self'` files instead of `data:` URLs blocked by `connect-src 'self'`.
    assetsInlineLimit: 0,
  },
  server: { port: 5173 },
  preview: {
    headers: {
      "Content-Security-Policy": HTTP_CSP,
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
    },
  },
});

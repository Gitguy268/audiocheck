import { defineConfig } from "vite";

// The page reads local files and never talks to a server. connect-src 'none' makes the
// browser enforce that. GitHub Pages cannot send headers, so the policy ships as a <meta>
// tag, added at build time only because the dev server needs inline scripts and a websocket.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

export default defineConfig({
  // Relative, so the same build works at /audiocheck/ on GitHub Pages and at / locally.
  base: "./",
  // Vite's preload polyfill uses fetch(), which the policy above forbids.
  build: { modulePreload: { polyfill: false } },
  // Not 4173, Vite's default: other projects' service workers may still own that port.
  preview: { port: 4411, strictPort: true },
  plugins: [
    {
      name: "csp-meta",
      apply: "build",
      transformIndexHtml: (html) =>
        html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
    },
  ],
});

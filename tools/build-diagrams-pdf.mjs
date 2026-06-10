#!/usr/bin/env node
// Render DIAGRAMS.md (with its Mermaid blocks) to DIAGRAMS.pdf.
//
// Usage:
//   npm install marked mermaid puppeteer-core    # one-time, anywhere on PATH
//   CHROME_PATH="/path/to/Chrome" node tools/build-diagrams-pdf.mjs
//
// Renders each ```mermaid block in a headless Chrome (vector SVG, not bitmap) and prints
// the whole document to an A4 PDF. Needs a local Chrome/Chromium (puppeteer-core does NOT
// download one). CHROME_PATH overrides the default macOS Google Chrome location.

import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createRequire } from "module";
import { marked } from "marked";
import puppeteer from "puppeteer-core";

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(REPO, "DIAGRAMS.md");
const OUT = path.join(REPO, "DIAGRAMS.pdf");
const CHROME = process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const md = fs.readFileSync(SRC, "utf8");
const mermaidJS = fs.readFileSync(require.resolve("mermaid/dist/mermaid.min.js"), "utf8");

// Pull the mermaid fences out so marked leaves them untouched, then put them back as divs.
const blocks = [];
const md2 = md.replace(/```mermaid\n([\s\S]*?)```/g, (_, code) => `\n\nXMERMAIDX${blocks.push(code) - 1}X\n\n`);
let body = marked.parse(md2);
blocks.forEach((code, i) => {
  const esc = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const tag = `<div class="mermaid">${esc}</div>`;
  body = body.replace(`<p>XMERMAIDX${i}X</p>`, tag).replace(`XMERMAIDX${i}X`, tag);
});

const css = `
  * { box-sizing: border-box; }
  body { margin: 0; color: #1a1d1a; font: 14.5px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif; }
  main { max-width: 900px; margin: 0 auto; padding: 6px 24px 24px; }
  h1 { font-size: 30px; letter-spacing: -0.5px; margin: 6px 0 2px; }
  h1 + p { color: #5b635b; margin-top: 0; }
  h2 { font-size: 21px; margin: 30px 0 12px; padding-bottom: 6px; border-bottom: 2px solid #0f7b4f; break-after: avoid; }
  h3 { font-size: 16px; margin: 20px 0 10px; color: #0f7b4f; break-after: avoid; }
  hr { border: none; border-top: 1px solid #e3e6e2; margin: 24px 0; }
  blockquote { margin: 12px 0; padding: 8px 14px; border-left: 3px solid #0f7b4f; background: #f3f7f4; color: #39413a; font-size: 13px; }
  code { font-family: ui-monospace,Menlo,Consolas,monospace; font-size: 12.5px; background: #f1f3f0; padding: 1px 5px; border-radius: 4px; }
  table { border-collapse: collapse; margin: 8px 0; }
  td, th { border: 1px solid #e3e6e2; padding: 5px 10px; font-size: 13px; text-align: left; }
  .mermaid { text-align: center; margin: 12px 0; break-inside: avoid; page-break-inside: avoid; }
  .mermaid svg { max-width: 100%; height: auto; }
`;

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style></head>
<body><main>${body}</main>
<script>${mermaidJS}</script>
<script>
  window.__ready = (async () => {
    mermaid.initialize({ startOnLoad: false, theme: "neutral",
      flowchart: { useMaxWidth: true }, sequence: { useMaxWidth: true },
      er: { useMaxWidth: true }, state: { useMaxWidth: true }, class: { useMaxWidth: true } });
    await mermaid.run({ querySelector: ".mermaid" });
    return document.querySelectorAll(".mermaid svg").length;
  })();
</script></body></html>`;

if (!fs.existsSync(CHROME)) {
  console.error(`Chrome not found at ${CHROME}. Set CHROME_PATH to your browser binary.`);
  process.exit(1);
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
await page.setContent(html, { waitUntil: "load", baseURL: pathToFileURL(REPO + "/").href });
const rendered = await page.evaluate(async () => await window.__ready);
await new Promise((r) => setTimeout(r, 400));
await page.pdf({
  path: OUT, format: "A4", printBackground: true,
  margin: { top: "15mm", bottom: "16mm", left: "13mm", right: "13mm" },
  displayHeaderFooter: true, headerTemplate: "<span></span>",
  footerTemplate: `<div style="font-size:8px;width:100%;text-align:center;color:#999;">Workout Logger — Diagrams · <span class="pageNumber"></span>/<span class="totalPages"></span></div>`,
});
await browser.close();
console.log(`wrote ${OUT} — ${rendered}/${blocks.length} diagrams${errs.length ? " | errors: " + errs.join("; ") : ""}`);

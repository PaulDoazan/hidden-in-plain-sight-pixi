#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import MarkdownIt from 'markdown-it';
import anchor from 'markdown-it-anchor';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DOC_DIR = resolve(ROOT, 'docs/handbook-websockets');
const MD_PATH = resolve(DOC_DIR, 'handbook.md');
const CSS_PATH = resolve(DOC_DIR, 'styles/print.css');
const OUT_PATH = resolve(DOC_DIR, 'handbook.html');

// GitHub-style slugify: lowercase, strip punctuation, collapse spaces to `-`,
// keep accented characters (é, è, à, ô, ç, ...) since they render fine in URLs
// and our TOC explicitly relies on them (e.g. `#4-nestjs-gateway-la-théorie`).
// Why custom: markdown-it-anchor v9 default keeps periods, colons, question
// marks and the typographer-substituted curly apostrophe (U+2019), producing
// URL-encoded anchors like `#4.-nestjs-gateway-%3A-la-th%C3%A9orie` that don't
// match the TOC and look ugly in the address bar.
const slugify = (s) =>
  s
    .normalize('NFC')
    // Replace curly quotes/apostrophes with nothing (matches `dune`, `lecran`).
    .replace(/[‘’“”]/g, '')
    .toLowerCase()
    // Drop anything that isn't a letter (incl. accents), digit, space or dash.
    .replace(/[^\p{L}\p{N} -]+/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

const md = new MarkdownIt({ html: true, linkify: true, typographer: true })
  .use(anchor, { permalink: anchor.permalink.headerLink(), slugify });

// Render fenced code blocks with language `mermaid` as <div class="mermaid">
const defaultFence = md.renderer.rules.fence;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  if (token.info.trim() === 'mermaid') {
    return `<div class="mermaid">\n${token.content}</div>\n`;
  }
  return defaultFence(tokens, idx, options, env, self);
};

const markdown = await readFile(MD_PATH, 'utf8');
const css = await readFile(CSS_PATH, 'utf8');
const body = md.render(markdown);

const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Handbook WebSockets — Hidden in Plain Sight</title>
<style>${css}</style>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
<script>
  mermaid.initialize({ startOnLoad: true, theme: 'default', securityLevel: 'loose' });
</script>
</head>
<body>
${body}
</body>
</html>
`;

await writeFile(OUT_PATH, html, 'utf8');
console.log(`Built ${OUT_PATH}`);

import fs from 'fs';
import path from 'path';
import MarkdownIt from 'markdown-it';

const docsDir = path.join(import.meta.dirname, '..', 'docs');
const outDir = path.join(import.meta.dirname, '..', 'public', 'docs');

const md = new MarkdownIt({ html: true, linkify: true, typographer: true });

// Discover all .md files
const files = fs.readdirSync(docsDir).filter(f => f.endsWith('.md'));

// Build sidebar from files
const sidebar = files.map(f => {
  const slug = f.replace('.md', '');
  const content = fs.readFileSync(path.join(docsDir, f), 'utf-8');
  const titleMatch = content.match(/^#\s+(.+)/m);
  const title = titleMatch ? titleMatch[1] : slug;
  return { slug, title, file: f };
});

function renderPage(activeSlug: string, htmlContent: string, title: string): string {
  const nav = sidebar.map(s =>
    `<a href="/docs/${s.slug}.html" class="nav-item ${s.slug === activeSlug ? 'active' : ''}">${s.title}</a>`
  ).join('\n          ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — TraceAIO Docs</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Instrument+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
:root {
  --bg-deep: #060a14;
  --bg-surface: #0a1020;
  --bg-elevated: #111a2e;
  --text-primary: #e8ecf4;
  --text-secondary: #8892a8;
  --text-dim: #505a70;
  --accent-blue: #2563eb;
  --accent-sky: #0ea5e9;
  --border: rgba(100, 130, 180, 0.1);
  --font-body: 'Instrument Sans', sans-serif;
  --font-mono: 'DM Mono', monospace;
}
html { scroll-behavior: smooth; }
body {
  background: var(--bg-deep);
  color: var(--text-primary);
  font-family: var(--font-body);
  line-height: 1.7;
  -webkit-font-smoothing: antialiased;
}
.layout {
  display: flex;
  min-height: 100vh;
}
.sidebar {
  width: 240px;
  padding: 24px 16px;
  border-right: 1px solid var(--border);
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
  flex-shrink: 0;
}
.sidebar-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 24px;
  text-decoration: none;
}
.sidebar-logo span {
  font-weight: 600;
  font-size: 16px;
  color: var(--text-primary);
}
.sidebar-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-dim);
  margin-bottom: 8px;
  padding-left: 12px;
}
.nav-item {
  display: block;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 14px;
  color: var(--text-secondary);
  text-decoration: none;
  transition: all 0.15s;
}
.nav-item:hover { color: var(--text-primary); background: var(--bg-elevated); }
.nav-item.active { color: var(--accent-sky); background: rgba(14, 165, 233, 0.08); }
.main {
  flex: 1;
  max-width: 780px;
  padding: 40px 48px 80px;
}
/* Markdown content styles */
.content h1 { font-size: 28px; font-weight: 700; margin-bottom: 8px; }
.content h2 { font-size: 20px; font-weight: 600; margin-top: 40px; margin-bottom: 12px; color: var(--text-primary); border-bottom: 1px solid var(--border); padding-bottom: 8px; }
.content h3 { font-size: 16px; font-weight: 600; margin-top: 28px; margin-bottom: 8px; }
.content p { margin-bottom: 16px; color: var(--text-secondary); }
.content a { color: var(--accent-sky); text-decoration: none; }
.content a:hover { text-decoration: underline; }
.content ul, .content ol { margin-bottom: 16px; padding-left: 24px; color: var(--text-secondary); }
.content li { margin-bottom: 4px; }
.content code {
  font-family: var(--font-mono);
  font-size: 13px;
  background: var(--bg-elevated);
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--accent-sky);
}
.content pre {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 20px;
  overflow-x: auto;
}
.content pre code {
  background: none;
  padding: 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}
.content table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 20px;
  font-size: 14px;
}
.content th {
  text-align: left;
  padding: 8px 12px;
  border-bottom: 2px solid var(--border);
  color: var(--text-primary);
  font-weight: 600;
}
.content td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  color: var(--text-secondary);
}
.content blockquote {
  border-left: 3px solid var(--accent-blue);
  padding: 8px 16px;
  margin-bottom: 16px;
  background: var(--bg-surface);
  border-radius: 0 6px 6px 0;
}
.content strong { color: var(--text-primary); }
.content img {
  max-width: 100%;
  border-radius: 8px;
  border: 1px solid var(--border);
  margin: 16px 0;
}
@media (max-width: 768px) {
  .sidebar { display: none; }
  .main { padding: 24px 16px; }
}
</style>
</head>
<body>
<div class="layout">
  <nav class="sidebar">
    <a href="/" class="sidebar-logo">
      <img src="/logo.png" alt="TraceAIO" height="28">
      <span>Docs</span>
    </a>
    <div class="sidebar-label">Documentation</div>
    ${nav}
    <div style="margin-top: 24px;">
      <a href="/" class="nav-item">Back to site</a>
      <a href="https://github.com/jakubsuchy/traceaio" class="nav-item" target="_blank">GitHub</a>
    </div>
  </nav>
  <main class="main">
    <div class="content">
      ${htmlContent}
    </div>
  </main>
</div>
</body>
</html>`;
}

// Build
fs.mkdirSync(outDir, { recursive: true });

for (const page of sidebar) {
  const raw = fs.readFileSync(path.join(docsDir, page.file), 'utf-8');
  const html = md.render(raw);
  const fullPage = renderPage(page.slug, html, page.title);
  fs.writeFileSync(path.join(outDir, `${page.slug}.html`), fullPage);
  console.log(`  ${page.slug}.html`);
}

// Index redirect
const indexHtml = `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=/docs/${sidebar[0]?.slug || 'getting-started'}.html"></head></html>`;
fs.writeFileSync(path.join(outDir, 'index.html'), indexHtml);

// Copy images
const imagesDir = path.join(docsDir, 'images');
if (fs.existsSync(imagesDir)) {
  const outImages = path.join(outDir, 'images');
  fs.mkdirSync(outImages, { recursive: true });
  for (const img of fs.readdirSync(imagesDir)) {
    fs.copyFileSync(path.join(imagesDir, img), path.join(outImages, img));
  }
  console.log(`  Copied ${fs.readdirSync(imagesDir).length} images`);
}

console.log(`\nBuilt ${sidebar.length} doc pages → public/docs/`);

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
<link href="https://fonts.googleapis.com/css2?family=Assistant:wght@400;500;600;700;800&family=Prompt:wght@400;500;600;700&family=Noto+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../styles.css">
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

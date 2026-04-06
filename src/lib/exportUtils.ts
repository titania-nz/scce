import { ExportFormat } from '@/types';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function inlineMarkdownToHtml(line: string): string {
  return escapeHtml(line)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

// Helper function: keeps a small, testable transformation isolated from UI side effects.
export function markdownToHtmlDocument(markdown: string, title: string): string {
  const lines = markdown.split(/\r?\n/);
  const blocks = lines.map((rawLine) => {
    const line = rawLine.trimEnd();
    if (!line.trim()) return '<p></p>';
    if (line.startsWith('### ')) return `<h3>${inlineMarkdownToHtml(line.slice(4))}</h3>`;
    if (line.startsWith('## ')) return `<h2>${inlineMarkdownToHtml(line.slice(3))}</h2>`;
    if (line.startsWith('# ')) return `<h1>${inlineMarkdownToHtml(line.slice(2))}</h1>`;
    if (line.startsWith('- ') || line.startsWith('* ')) return `<li>${inlineMarkdownToHtml(line.slice(2))}</li>`;
    return `<p>${inlineMarkdownToHtml(line)}</p>`;
  });

  const normalizedBlocks = blocks.join('\n').replace(/(<li>[\s\S]*?<\/li>)(?:\n(?!<li>))/g, '$1\n');

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; max-width: 900px; margin: 0 auto; padding: 2rem; line-height: 1.6; }
      h1, h2, h3 { line-height: 1.2; }
      code { background: #f0f0f0; padding: 0.1rem 0.3rem; border-radius: 0.25rem; }
      pre { background: #111827; color: #f9fafb; padding: 1rem; border-radius: 0.5rem; overflow: auto; }
      ul { padding-left: 1.5rem; }
    </style>
  </head>
  <body>
    ${normalizedBlocks}
  </body>
</html>`;
}

function escapePdfText(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}

// Helper function: keeps a small, testable transformation isolated from UI side effects.
export function markdownToSimplePdf(markdown: string, title: string): Uint8Array {
  const contentLines = [title, '', ...markdown.split(/\r?\n/)];
  const maxLines = 60;
  const clipped = contentLines.slice(0, maxLines);
  const textOps = clipped
    .map((line, index) => `BT /F1 11 Tf 50 ${780 - (index * 12)} Td (${escapePdfText(line)}) Tj ET`)
    .join('\n');

  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj',
    '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
    `5 0 obj << /Length ${textOps.length} >> stream\n${textOps}\nendstream endobj`,
  ];

  const parts: string[] = ['%PDF-1.4\n'];
  const offsets: number[] = [0];

  for (const object of objects) {
    offsets.push(parts.join('').length);
    parts.push(`${object}\n`);
  }

  const xrefStart = parts.join('').length;
  parts.push(`xref\n0 ${objects.length + 1}\n`);
  parts.push('0000000000 65535 f \n');
  for (let i = 1; i <= objects.length; i += 1) {
    parts.push(`${offsets[i].toString().padStart(10, '0')} 00000 n \n`);
  }
  parts.push(`trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);

  return new TextEncoder().encode(parts.join(''));
}

// Helper function: keeps a small, testable transformation isolated from UI side effects.
export function markdownToDocxXml(markdown: string, title: string): string {
  const paragraphs = [title, '', ...markdown.split(/\r?\n/)]
    .map((line) => `<w:p><w:r><w:t xml:space="preserve">${escapeHtml(line)}</w:t></w:r></w:p>`)
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs}
  </w:body>
</w:document>`;
}

// Helper function: keeps a small, testable transformation isolated from UI side effects.
export function resolveExportMimeType(format: ExportFormat): string {
  if (format === 'html') return 'text/html; charset=utf-8';
  if (format === 'pdf') return 'application/pdf';
  return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
}

import { NextRequest, NextResponse } from 'next/server';
import { readNoteFile } from '@/lib/noteContentStorage';
import { parseFilename } from '@/lib/parseFilename';
import { ExportFormat } from '@/types';
import {
  markdownToDocxXml,
  markdownToHtmlDocument,
  markdownToSimplePdf,
  resolveExportMimeType,
} from '@/lib/exportUtils';

type Params = { params: Promise<{ filename: string[] }> };

const VALID_FORMATS: ExportFormat[] = ['html', 'pdf', 'docx'];

function parseFormat(input: string | null): ExportFormat {
  if (!input || !VALID_FORMATS.includes(input as ExportFormat)) {
    throw Object.assign(new Error('Invalid format'), { status: 400 });
  }
  return input as ExportFormat;
}

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function GET(request: NextRequest, { params }: Params) {
  const { filename: rawFilename } = await params;

  try {
    const filename = parseFilename(rawFilename);
    const format = parseFormat(request.nextUrl.searchParams.get('format'));
    const content = await readNoteFile(filename);

    const title = filename.replace(/\.md$/i, '');
    const basename = filename.replace(/\.md$/i, '');
    const exportName = `${basename}.${format}`;

    if (format === 'pdf') {
      const pdf = markdownToSimplePdf(content, title);
      return new NextResponse(Buffer.from(pdf), {
        headers: {
          'Content-Type': resolveExportMimeType(format),
          'Content-Disposition': `attachment; filename="${encodeURIComponent(exportName)}"`,
        },
      });
    }

    const output = format === 'html'
      ? markdownToHtmlDocument(content, title)
      : markdownToDocxXml(content, title);

    return new NextResponse(output, {
      headers: {
        'Content-Type': resolveExportMimeType(format),
        'Content-Disposition': `attachment; filename="${encodeURIComponent(exportName)}"`,
      },
    });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 404) return NextResponse.json({ error: 'File not found' }, { status: 404 });
    if (e.status === 400) return NextResponse.json({ error: e.message ?? 'Invalid request' }, { status: 400 });
    return NextResponse.json({ error: 'Could not export file' }, { status: 500 });
  }
}

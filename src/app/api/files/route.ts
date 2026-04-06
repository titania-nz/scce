import { NextRequest, NextResponse } from 'next/server';
import { fileExists, listFiles, readFile, writeFile } from '@/lib/fileStorage';
import { readRevisions } from '@/lib/revisionStorage';
import { parseMetaFromContent, summarizeRevisionMeta } from '@/lib/revisionMeta';

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function GET(request: NextRequest) {
  try {
    const files = await listFiles();
    const includeMeta = request.nextUrl.searchParams.get('includeMeta');
    if (includeMeta !== '1' && includeMeta !== 'true') {
      return NextResponse.json({ files });
    }

    const filesWithMeta = await Promise.all(
      files.map(async (file) => {
        try {
          const revisions = await readRevisions(file.name);
          const revisionMeta = summarizeRevisionMeta(revisions);
          if (revisionMeta.note || revisionMeta.status || revisionMeta.tags.length > 0) {
            return { ...file, ...revisionMeta };
          }

          const content = await readFile(file.name);
          return { ...file, ...parseMetaFromContent(content) };
        } catch {
          return { ...file, note: '', status: '', tags: [] };
        }
      }),
    );
    return NextResponse.json({ files: filesWithMeta });
  } catch {
    return NextResponse.json({ error: 'Could not read notes directory' }, { status: 500 });
  }
}

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, content = '' } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
    }
    if (!name.endsWith('.md')) {
      return NextResponse.json({ error: 'Filename must end with .md' }, { status: 400 });
    }
    if (await fileExists(name)) {
      return NextResponse.json({ error: 'File already exists' }, { status: 409 });
    }

    await writeFile(name, content);
    return NextResponse.json({ name }, { status: 201 });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 400) {
      return NextResponse.json({ error: e.message ?? 'Invalid filename' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Could not create file' }, { status: 500 });
  }
}

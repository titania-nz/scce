import { NextRequest, NextResponse } from 'next/server';
import { listNoteFiles } from '@/lib/noteIndexStorage';
import { noteFileExists, readNoteFile, writeNoteFile } from '@/lib/noteContentStorage';
import { readFileCategory } from '@/lib/fileCategoryStorage';
import { readFolders } from '@/lib/folderStorage';
import { readRevisions } from '@/lib/revisionStorage';
import { parseMetaFromContent, summarizeRevisionMeta } from '@/lib/revisionMeta';

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function GET(request: NextRequest) {
  try {
    const [files, folders] = await Promise.all([listNoteFiles(), readFolders()]);
    const includeMeta = request.nextUrl.searchParams.get('includeMeta');
    const shouldIncludeMeta = includeMeta === '1' || includeMeta === 'true';

    const filesWithMeta = await Promise.all(
      files.map(async (file) => {
        const category = await readFileCategory(file.name);
        if (!shouldIncludeMeta) {
          return { ...file, category };
        }

        try {
          const revisions = await readRevisions(file.name);
          const revisionMeta = summarizeRevisionMeta(revisions);
          if (revisionMeta.note || revisionMeta.status || revisionMeta.tags.length > 0) {
            return { ...file, category, ...revisionMeta };
          }

          const content = await readNoteFile(file.name);
          return { ...file, category, ...parseMetaFromContent(content) };
        } catch {
          return { ...file, category, note: '', status: '', tags: [] };
        }
      }),
    );
    return NextResponse.json({ files: filesWithMeta, folders });
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
    if (typeof content !== 'string') {
      return NextResponse.json({ error: 'Invalid content' }, { status: 400 });
    }
    if (await noteFileExists(name)) {
      return NextResponse.json({ error: 'File already exists' }, { status: 409 });
    }

    await writeNoteFile(name, content);
    return NextResponse.json({ name }, { status: 201 });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 400) {
      return NextResponse.json({ error: e.message ?? 'Invalid filename' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Could not create file' }, { status: 500 });
  }
}

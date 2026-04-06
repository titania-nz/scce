import { NextRequest, NextResponse } from 'next/server';
import { readFile, writeFile, deleteFile, renameFile } from '@/lib/fileStorage';
import { deleteRevisions, readRevisions, renameRevisions, writeRevisions } from '@/lib/revisionStorage';
import { deletePublishHistory, renamePublishHistory } from '@/lib/publishStorage';
import { parseFilename } from '@/lib/parseFilename';
import { Revision } from '@/types';

type Params = { params: Promise<{ filename: string[] }> };

// Helper function: keeps a small, testable transformation isolated from UI side effects.
function parseStatus(input: unknown): string | undefined {
  if (input === undefined || input === null || input === '') return undefined;
  if (typeof input !== 'string') {
    throw Object.assign(new Error('Invalid status'), { status: 400 });
  }
  const normalized = input.trim();
  if (!normalized) return undefined;
  if (normalized.length > 80) {
    throw Object.assign(new Error('Status is too long'), { status: 400 });
  }
  return normalized;
}

// Helper function: keeps a small, testable transformation isolated from UI side effects.
function parseTags(input: unknown): string[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) {
    throw Object.assign(new Error('Invalid tags'), { status: 400 });
  }
  return input
    .filter((tag) => typeof tag === 'string')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function GET(_request: NextRequest, { params }: Params) {
  const { filename: rawFilename } = await params;
  try {
    const filename = parseFilename(rawFilename);
    const [content, revisions] = await Promise.all([readFile(filename), readRevisions(filename)]);
    const requestUrl = _request.nextUrl;
    const revisionId = requestUrl.searchParams.get('revisionId');
    const selectedRevision = revisionId
      ? revisions.find((revision) => revision.id === revisionId)
      : null;

    if (revisionId && !selectedRevision) {
      return NextResponse.json({ error: 'Revision not found' }, { status: 404 });
    }

    return NextResponse.json({
      name: filename,
      content: selectedRevision?.content ?? content,
      revisions,
      revisionId: selectedRevision?.id ?? null,
    });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 404) return NextResponse.json({ error: 'File not found' }, { status: 404 });
    if (e.status === 400) return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
    return NextResponse.json({ error: 'Could not read file' }, { status: 500 });
  }
}

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function PUT(request: NextRequest, { params }: Params) {
  const { filename: rawFilename } = await params;
  try {
    const filename = parseFilename(rawFilename);
    const body = await request.json();

    if ('newName' in body) {
      const { newName } = body;
      if (!newName || typeof newName !== 'string') {
        return NextResponse.json({ error: 'Invalid new filename' }, { status: 400 });
      }
      if (!newName.endsWith('.md')) {
        return NextResponse.json({ error: 'Filename must end with .md' }, { status: 400 });
      }
      await renameFile(filename, newName);
      await renameRevisions(filename, newName);
      await renamePublishHistory(filename, newName);
      return NextResponse.json({ name: newName });
    } else if ('content' in body) {
      const { content } = body;
      if (typeof content !== 'string') {
        return NextResponse.json({ error: 'Invalid content' }, { status: 400 });
      }

      const note = typeof body.note === 'string' ? body.note.trim() : '';
      const tags = parseTags(body.tags);
      const status = parseStatus(body.status);

      await writeFile(filename, content);

      const revisions = await readRevisions(filename);
      const lastRevision = revisions.at(-1);
      const lastTags = lastRevision?.tags ?? [];

      const tagsChanged =
        lastTags.length !== tags.length ||
        [...tags].sort().join('\0') !== [...lastTags].sort().join('\0');

      const shouldAppendRevision =
        !lastRevision ||
        lastRevision.content !== content ||
        lastRevision.note !== note ||
        lastRevision.status !== status ||
        tagsChanged;

      const updatedRevisions = shouldAppendRevision
        ? [
            ...revisions,
            {
              id: crypto.randomUUID(),
              createdAt: new Date().toISOString(),
              content,
              note,
              tags,
              status,
            } satisfies Revision,
          ]
        : revisions;

      if (shouldAppendRevision) {
        await writeRevisions(filename, updatedRevisions);
      }

      return NextResponse.json({ name: filename, revisions: updatedRevisions });
    } else {
      return NextResponse.json({ error: 'Missing content or newName' }, { status: 400 });
    }
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 404) return NextResponse.json({ error: 'File not found' }, { status: 404 });
    if (e.status === 409) return NextResponse.json({ error: 'File already exists' }, { status: 409 });
    if (e.status === 400) return NextResponse.json({ error: e.message ?? 'Invalid request' }, { status: 400 });
    return NextResponse.json({ error: 'Could not update file' }, { status: 500 });
  }
}

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { filename: rawFilename } = await params;
  try {
    const filename = parseFilename(rawFilename);
    await deleteFile(filename);
    await deleteRevisions(filename);
    await deletePublishHistory(filename);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 404) return NextResponse.json({ error: 'File not found' }, { status: 404 });
    if (e.status === 400) return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
    return NextResponse.json({ error: 'Could not delete file' }, { status: 500 });
  }
}

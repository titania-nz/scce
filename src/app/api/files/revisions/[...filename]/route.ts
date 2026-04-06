import { NextResponse } from 'next/server';
import { readRevisions } from '@/lib/revisionStorage';
import { parseFilename } from '@/lib/parseFilename';
import { readRevisions, writeRevisions } from '@/lib/revisionStorage';
import { RevisionInlineNote } from '@/types';

type Params = { params: Promise<{ filename: string[] }> };
// Keep this route on a single storage import path to avoid duplicate-import merge
// regressions (e.g. duplicate `readRevisions` symbols in Turbopack builds).

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function GET(_request: Request, { params }: Params) {
  try {
    const { filename: rawFilename } = await params;
    const filename = parseFilename(rawFilename);
    const revisions = await readRevisions(filename);
    return NextResponse.json({
      name: filename,
      currentDraftRevisionId: null,
      revisions: revisions.map((revision) => ({
        id: revision.id,
        createdAt: revision.createdAt,
        size: new TextEncoder().encode(revision.content).byteLength,
      })),
    });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 404) return NextResponse.json({ error: 'File not found' }, { status: 404 });
    if (e.status === 400) return NextResponse.json({ error: e.message ?? 'Invalid filename' }, { status: 400 });
    return NextResponse.json({ error: 'Could not list revisions' }, { status: 500 });
  }
}

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { filename: rawFilename } = await params;
    const filename = parseFilename(rawFilename);
    const body = await request.json();

    const { revisionId, inlineNotes } = body as {
      revisionId?: unknown;
      inlineNotes?: unknown;
    };

    if (!revisionId || typeof revisionId !== 'string') {
      return NextResponse.json({ error: 'Invalid revisionId' }, { status: 400 });
    }
    if (!Array.isArray(inlineNotes)) {
      return NextResponse.json({ error: 'Invalid inlineNotes' }, { status: 400 });
    }

    const sanitizedInlineNotes: RevisionInlineNote[] = inlineNotes
      .filter((item): item is Partial<RevisionInlineNote> => Boolean(item) && typeof item === 'object')
      .map((item) => ({
        id: typeof item.id === 'string' && item.id ? item.id : crypto.randomUUID(),
        message: typeof item.message === 'string' ? item.message.trim() : '',
        lineNumber:
          typeof item.lineNumber === 'number' && Number.isFinite(item.lineNumber) && item.lineNumber > 0
            ? Math.floor(item.lineNumber)
            : null,
        createdAt:
          typeof item.createdAt === 'string' && item.createdAt
            ? item.createdAt
            : new Date().toISOString(),
      }))
      .filter((item) => item.message.length > 0);

    const revisions = await readRevisions(filename);
    const targetIdx = revisions.findIndex((revision) => revision.id === revisionId);
    if (targetIdx === -1) {
      return NextResponse.json({ error: 'Revision not found' }, { status: 404 });
    }

    revisions[targetIdx] = {
      ...revisions[targetIdx],
      inlineNotes: sanitizedInlineNotes,
    };

    await writeRevisions(filename, revisions);

    return NextResponse.json({
      name: filename,
      revisionId,
      inlineNotes: sanitizedInlineNotes,
    });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 404) return NextResponse.json({ error: 'File not found' }, { status: 404 });
    if (e.status === 400) return NextResponse.json({ error: e.message ?? 'Invalid filename' }, { status: 400 });
    return NextResponse.json({ error: 'Could not update revision notes' }, { status: 500 });
  }
}

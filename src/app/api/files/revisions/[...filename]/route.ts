import { NextResponse } from 'next/server';
import { readRevisions } from '@/lib/revisionStorage';
import { parseFilename } from '@/lib/parseFilename';

type Params = { params: Promise<{ filename: string[] }> };

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

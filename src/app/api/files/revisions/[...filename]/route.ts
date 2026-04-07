import { NextResponse } from 'next/server';
import { parseFilename } from '@/lib/parseFilename';
import { readRevisions, writeRevisions } from '@/lib/revisionStorage';
import {
  applyRevisionInlineNotesUpdate,
  parseRevisionInlineNotesUpdate,
} from '@/lib/revisionInlineNotes';

type Params = { params: Promise<{ filename: string[] }> };

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function GET(_request: Request, { params }: Params) {
  try {
    const { filename: rawFilename } = await params;
    const filename = parseFilename(rawFilename);
    const revisions = await readRevisions(filename);
    return NextResponse.json({
      name: filename,
      revisions,
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
    const payload = parseRevisionInlineNotesUpdate(body);
    const revisions = await readRevisions(filename);
    const updatedRevisions = applyRevisionInlineNotesUpdate(revisions, payload);
    await writeRevisions(filename, updatedRevisions);
    return NextResponse.json({
      name: filename,
      revisions: updatedRevisions,
    });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 404) return NextResponse.json({ error: 'Revision not found' }, { status: 404 });
    if (e.status === 400) return NextResponse.json({ error: e.message ?? 'Invalid request' }, { status: 400 });
    return NextResponse.json({ error: 'Could not update revision notes' }, { status: 500 });
  }
}

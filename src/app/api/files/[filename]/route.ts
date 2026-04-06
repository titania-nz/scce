import { NextRequest, NextResponse } from 'next/server';
import {
  createRevision,
  deleteFile,
  getCurrentDraftContent,
  readRevision,
  renameFile,
} from '@/lib/fileStorage';

type Params = { params: Promise<{ filename: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { filename } = await params;
  const revisionId = request.nextUrl.searchParams.get('revisionId');
  try {
    if (revisionId) {
      const content = await readRevision(filename, revisionId);
      return NextResponse.json({ name: filename, content, revisionId });
    }

    const draft = await getCurrentDraftContent(filename);
    return NextResponse.json({
      name: filename,
      content: draft.content,
      revisionId: draft.revisionId,
      currentDraftRevisionId: draft.revisionId,
    });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 404) return NextResponse.json({ error: 'File not found' }, { status: 404 });
    if (e.status === 400) return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
    return NextResponse.json({ error: 'Could not read file' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { filename } = await params;
  try {
    const body = await request.json();

    if ('newName' in body) {
      // Rename operation
      const { newName } = body;
      if (!newName || typeof newName !== 'string') {
        return NextResponse.json({ error: 'Invalid new filename' }, { status: 400 });
      }
      await renameFile(filename, newName);
      return NextResponse.json({ name: newName });
    } else if ('content' in body) {
      // Save operation
      const { content } = body;
      if (typeof content !== 'string') {
        return NextResponse.json({ error: 'Invalid content' }, { status: 400 });
      }
      const revision = await createRevision(filename, content, { setAsDraft: true });
      return NextResponse.json({ name: filename, revisionId: revision.id });
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

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { filename } = await params;
  try {
    await deleteFile(filename);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 404) return NextResponse.json({ error: 'File not found' }, { status: 404 });
    if (e.status === 400) return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
    return NextResponse.json({ error: 'Could not delete file' }, { status: 500 });
  }
}

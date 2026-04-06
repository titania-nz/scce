import { NextRequest, NextResponse } from 'next/server';
import { addRevisionComment, listRevisionComments } from '@/lib/fileStorage';

type Params = { params: Promise<{ documentId: string; revisionId: string }> };

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function GET(_request: NextRequest, { params }: Params) {
  const { documentId, revisionId } = await params;
  try {
    const comments = await listRevisionComments(documentId, revisionId);
    return NextResponse.json({ comments });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 400) return NextResponse.json({ error: e.message ?? 'Invalid IDs' }, { status: 400 });
    if (e.status === 404) return NextResponse.json({ error: 'Revision not found' }, { status: 404 });
    return NextResponse.json({ error: 'Could not fetch comments' }, { status: 500 });
  }
}

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function POST(request: NextRequest, { params }: Params) {
  const { documentId, revisionId } = await params;
  try {
    const body = await request.json();
    const message = typeof body?.message === 'string' ? body.message : '';
    const parentId = typeof body?.parentId === 'string' ? body.parentId : undefined;
    const comment = await addRevisionComment(documentId, revisionId, { message, parentId });
    return NextResponse.json({ comment }, { status: 201 });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 400) return NextResponse.json({ error: e.message ?? 'Invalid request' }, { status: 400 });
    if (e.status === 404) return NextResponse.json({ error: 'Revision not found' }, { status: 404 });
    return NextResponse.json({ error: 'Could not add comment' }, { status: 500 });
  }
}

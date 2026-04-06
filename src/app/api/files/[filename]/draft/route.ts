import { NextRequest, NextResponse } from 'next/server';
import { promoteRevisionToDraft } from '@/lib/fileStorage';

type Params = { params: Promise<{ filename: string }> };

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function POST(request: NextRequest, { params }: Params) {
  const { filename } = await params;

  try {
    const body = await request.json();
    const { revisionId } = body;

    if (!revisionId || typeof revisionId !== 'string') {
      return NextResponse.json({ error: 'Invalid revisionId' }, { status: 400 });
    }

    await promoteRevisionToDraft(filename, revisionId);
    return NextResponse.json({ name: filename, currentDraftRevisionId: revisionId });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 404) return NextResponse.json({ error: 'Revision not found' }, { status: 404 });
    if (e.status === 400) return NextResponse.json({ error: e.message ?? 'Invalid request' }, { status: 400 });
    return NextResponse.json({ error: 'Could not promote revision' }, { status: 500 });
  }
}

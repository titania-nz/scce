import { NextRequest, NextResponse } from 'next/server';
import { getRevision } from '@/lib/fileStorage';

type Params = { params: Promise<{ documentId: string; revisionId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { documentId, revisionId } = await params;

  try {
    const revision = await getRevision(documentId, revisionId);
    return NextResponse.json({ revision });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 400) {
      return NextResponse.json({ error: e.message ?? 'Invalid IDs' }, { status: 400 });
    }
    if (e.status === 404) {
      return NextResponse.json({ error: 'Revision not found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Could not fetch revision' }, { status: 500 });
  }
}

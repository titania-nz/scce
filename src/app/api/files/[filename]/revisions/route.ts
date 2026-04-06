import { NextResponse } from 'next/server';
import { listRevisions } from '@/lib/fileStorage';

type Params = { params: Promise<{ filename: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { filename } = await params;
  try {
    const meta = await listRevisions(filename);
    return NextResponse.json({
      name: filename,
      currentDraftRevisionId: meta.currentDraftRevisionId,
      revisions: meta.revisions,
    });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 404) return NextResponse.json({ error: 'File not found' }, { status: 404 });
    if (e.status === 400) return NextResponse.json({ error: e.message ?? 'Invalid filename' }, { status: 400 });
    return NextResponse.json({ error: 'Could not list revisions' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getDocumentBranchState, updateDocumentBranchState } from '@/lib/documentStorage';

type Params = { params: Promise<{ documentId: string }> };

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function GET(_request: NextRequest, { params }: Params) {
  const { documentId } = await params;
  try {
    const branches = await getDocumentBranchState(documentId);
    return NextResponse.json({ branches });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 400) return NextResponse.json({ error: e.message ?? 'Invalid document ID' }, { status: 400 });
    if (e.status === 404) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    return NextResponse.json({ error: 'Could not fetch branch state' }, { status: 500 });
  }
}

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function PUT(request: NextRequest, { params }: Params) {
  const { documentId } = await params;
  try {
    const body = await request.json();
    const branches = await updateDocumentBranchState(documentId, body);
    return NextResponse.json({ branches });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 400) return NextResponse.json({ error: e.message ?? 'Invalid request' }, { status: 400 });
    if (e.status === 404) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    return NextResponse.json({ error: 'Could not update branch state' }, { status: 500 });
  }
}

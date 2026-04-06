import { NextRequest, NextResponse } from 'next/server';
import { promoteDocumentBranch } from '@/lib/fileStorage';
import { DocumentBranchName } from '@/types';

type Params = { params: Promise<{ documentId: string; revisionId: string }> };

const VALID_BRANCHES: DocumentBranchName[] = ['draft', 'accepted', 'canonical'];

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function POST(request: NextRequest, { params }: Params) {
  const { documentId, revisionId } = await params;

  try {
    const body = await request.json();
    const branch = body?.branch;

    if (!VALID_BRANCHES.includes(branch as DocumentBranchName)) {
      return NextResponse.json({ error: 'Invalid branch' }, { status: 400 });
    }

    const branches = await promoteDocumentBranch(documentId, revisionId, branch as DocumentBranchName);
    return NextResponse.json({ branches });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 400) return NextResponse.json({ error: e.message ?? 'Invalid request' }, { status: 400 });
    if (e.status === 404) return NextResponse.json({ error: 'Revision not found' }, { status: 404 });
    return NextResponse.json({ error: 'Could not promote revision' }, { status: 500 });
  }
}

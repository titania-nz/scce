import { NextRequest, NextResponse } from 'next/server';
import {
  appendImmutableRevision,
  createDocumentRootRecord,
  listRevisionsByDocumentId,
} from '@/lib/documentStorage';
import { isRevisionStatus } from '@/lib/revisionStatus';

type Params = { params: Promise<{ documentId: string }> };

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function GET(_request: NextRequest, { params }: Params) {
  const { documentId } = await params;

  try {
    const revisions = await listRevisionsByDocumentId(documentId);
    return NextResponse.json({ revisions });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 400) {
      return NextResponse.json({ error: e.message ?? 'Invalid document ID' }, { status: 400 });
    }
    if (e.status === 404) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Could not list revisions' }, { status: 500 });
  }
}

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function POST(request: NextRequest, { params }: Params) {
  const { documentId } = await params;

  try {
    const body = await request.json();
    const { content, notes = [], documentName, collaboration, status } = body;

    if (typeof content !== 'string') {
      return NextResponse.json({ error: 'Invalid content' }, { status: 400 });
    }

    if (status !== undefined && status !== null && !isRevisionStatus(status)) {
      return NextResponse.json({ error: 'Status must be Writing, Editing, or Locked' }, { status: 400 });
    }

    try {
      await listRevisionsByDocumentId(documentId);
    } catch (err: unknown) {
      const e = err as { status?: number };
      if (e.status === 404) {
        const fallbackName =
          typeof documentName === 'string' && documentName.length > 0
            ? documentName
            : `${documentId}.md`;

        await createDocumentRootRecord({
          id: documentId,
          name: fallbackName,
        });
      } else {
        throw err;
      }
    }

    const revision = await appendImmutableRevision(documentId, {
      content,
      status,
      notes: Array.isArray(notes) ? notes : [],
      collaboration: typeof collaboration === 'object' && collaboration ? collaboration : undefined,
    });

    return NextResponse.json({ revision }, { status: 201 });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 400) {
      return NextResponse.json({ error: e.message ?? 'Invalid request' }, { status: 400 });
    }
    if (e.status === 404) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }
    if (e.status === 409) {
      return NextResponse.json({ error: 'Document already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Could not create revision' }, { status: 500 });
  }
}

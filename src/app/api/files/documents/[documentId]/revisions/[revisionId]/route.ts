'use server';

import { NextRequest, NextResponse } from 'next/server';
import { getRevision, mutateRevisionCollaboration } from '@/lib/fileStorage';

type Params = { params: Promise<{ documentId: string; revisionId: string }> };

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
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

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function PATCH(request: NextRequest, { params }: Params) {
  const { documentId, revisionId } = await params;

  try {
    const body = (await request.json()) as {
      actorId?: string;
      actorName?: string;
      presence?: unknown;
      lock?: unknown;
      addComment?: unknown;
      requestReview?: unknown;
      mention?: unknown;
      markNotificationReadId?: unknown;
    };

    if (typeof body.actorId !== 'string' || typeof body.actorName !== 'string') {
      return NextResponse.json({ error: 'actorId and actorName are required' }, { status: 400 });
    }

    const revision = await mutateRevisionCollaboration(documentId, revisionId, {
      actorId: body.actorId,
      actorName: body.actorName,
      presence: Array.isArray(body.presence)
        ? body.presence
            .filter(
              (entry): entry is { userId: string; displayName: string; startedAt: string; lastSeenAt: string } =>
                typeof entry === 'object' &&
                entry !== null &&
                typeof (entry as { userId?: unknown }).userId === 'string' &&
                typeof (entry as { displayName?: unknown }).displayName === 'string' &&
                typeof (entry as { startedAt?: unknown }).startedAt === 'string' &&
                typeof (entry as { lastSeenAt?: unknown }).lastSeenAt === 'string',
            )
        : undefined,
      lock:
        body.lock === null
          ? null
          : typeof body.lock === 'object' &&
              body.lock !== null &&
              typeof (body.lock as { userId?: unknown }).userId === 'string' &&
              typeof (body.lock as { displayName?: unknown }).displayName === 'string' &&
              typeof (body.lock as { createdAt?: unknown }).createdAt === 'string'
            ? {
                userId: (body.lock as { userId: string }).userId,
                displayName: (body.lock as { displayName: string }).displayName,
                createdAt: (body.lock as { createdAt: string }).createdAt,
                expiresAt:
                  typeof (body.lock as { expiresAt?: unknown }).expiresAt === 'string'
                    ? (body.lock as { expiresAt: string }).expiresAt
                    : undefined,
                reason:
                  typeof (body.lock as { reason?: unknown }).reason === 'string'
                    ? (body.lock as { reason: string }).reason
                    : undefined,
              }
            : undefined,
      addComment:
        typeof body.addComment === 'object' &&
        body.addComment !== null &&
        typeof (body.addComment as { message?: unknown }).message === 'string'
          ? { message: (body.addComment as { message: string }).message }
          : undefined,
      requestReview:
        typeof body.requestReview === 'object' &&
        body.requestReview !== null &&
        typeof (body.requestReview as { reviewerId?: unknown }).reviewerId === 'string' &&
        typeof (body.requestReview as { reviewerName?: unknown }).reviewerName === 'string'
          ? {
              reviewerId: (body.requestReview as { reviewerId: string }).reviewerId,
              reviewerName: (body.requestReview as { reviewerName: string }).reviewerName,
              message:
                typeof (body.requestReview as { message?: unknown }).message === 'string'
                  ? (body.requestReview as { message: string }).message
                  : undefined,
            }
          : undefined,
      mention:
        typeof body.mention === 'object' &&
        body.mention !== null &&
        typeof (body.mention as { toUserId?: unknown }).toUserId === 'string' &&
        typeof (body.mention as { message?: unknown }).message === 'string'
          ? {
              toUserId: (body.mention as { toUserId: string }).toUserId,
              message: (body.mention as { message: string }).message,
            }
          : undefined,
      markNotificationReadId:
        typeof body.markNotificationReadId === 'string' ? body.markNotificationReadId : undefined,
    });

    return NextResponse.json({ revision });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 400) {
      return NextResponse.json({ error: e.message ?? 'Invalid IDs' }, { status: 400 });
    }
    if (e.status === 404) {
      return NextResponse.json({ error: 'Revision not found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Could not update collaboration state' }, { status: 500 });
  }
}

import type { Revision, RevisionInlineNote } from '../types';

export interface RevisionInlineNotesUpdatePayload {
  revisionId: string;
  inlineNotes: RevisionInlineNote[];
}

function createHttpError(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function normalizeInlineNote(note: unknown): RevisionInlineNote {
  if (!note || typeof note !== 'object') {
    throw createHttpError('Invalid inline note', 400);
  }

  const candidate = note as Partial<RevisionInlineNote>;
  if (typeof candidate.message !== 'string') {
    throw createHttpError('Inline note message must be a string', 400);
  }

  const lineNumber = candidate.lineNumber;
  if (
    lineNumber !== null &&
    lineNumber !== undefined &&
    (typeof lineNumber !== 'number' || !Number.isFinite(lineNumber) || lineNumber <= 0)
  ) {
    throw createHttpError('Inline note lineNumber must be null or a positive number', 400);
  }

  return {
    id: typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id : crypto.randomUUID(),
    message: candidate.message,
    lineNumber: typeof lineNumber === 'number' ? Math.floor(lineNumber) : null,
    createdAt:
      typeof candidate.createdAt === 'string' && candidate.createdAt.trim()
        ? candidate.createdAt
        : new Date().toISOString(),
  };
}

export function parseRevisionInlineNotesUpdate(body: unknown): RevisionInlineNotesUpdatePayload {
  if (!body || typeof body !== 'object') {
    throw createHttpError('Invalid request body', 400);
  }

  const candidate = body as {
    revisionId?: unknown;
    inlineNotes?: unknown;
  };

  if (typeof candidate.revisionId !== 'string' || !candidate.revisionId.trim()) {
    throw createHttpError('Invalid revisionId', 400);
  }

  if (!Array.isArray(candidate.inlineNotes)) {
    throw createHttpError('Invalid inlineNotes', 400);
  }

  return {
    revisionId: candidate.revisionId,
    inlineNotes: candidate.inlineNotes.map(normalizeInlineNote),
  };
}

export function applyRevisionInlineNotesUpdate(
  revisions: Revision[],
  payload: RevisionInlineNotesUpdatePayload,
): Revision[] {
  let matched = false;

  const updatedRevisions = revisions.map((revision) => {
    if (revision.id !== payload.revisionId) {
      return revision;
    }

    matched = true;
    return {
      ...revision,
      inlineNotes: payload.inlineNotes,
    };
  });

  if (!matched) {
    throw createHttpError('Revision not found', 404);
  }

  return updatedRevisions;
}

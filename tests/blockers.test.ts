import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthToken, verifyAuthToken } from '../src/lib/authToken.ts';
import {
  applyRevisionInlineNotesUpdate,
  parseRevisionInlineNotesUpdate,
} from '../src/lib/revisionInlineNotes.ts';
import type { Revision } from '../src/types/index.ts';

test('auth tokens created for login verify against the same secret', () => {
  const secret = 'super-secret-value';
  const token = createAuthToken(secret);

  assert.equal(typeof token, 'string');
  assert.notEqual(token, secret);
  assert.equal(verifyAuthToken(token, secret), true);
  assert.equal(verifyAuthToken(token, `${secret}-other`), false);
});

test('revision inline note updates replace notes for the matching revision only', () => {
  const revisions: Revision[] = [
    {
      id: 'rev-1',
      createdAt: '2026-04-07T00:00:00.000Z',
      content: '# One',
      note: 'first',
      tags: ['draft'],
      status: 'Writing',
    },
    {
      id: 'rev-2',
      createdAt: '2026-04-07T01:00:00.000Z',
      content: '# Two',
      note: 'second',
      tags: ['review'],
      status: 'Editing',
    },
  ];

  const payload = parseRevisionInlineNotesUpdate({
    revisionId: 'rev-2',
    inlineNotes: [
      {
        id: 'note-1',
        message: 'Check this heading',
        lineNumber: 3,
        createdAt: '2026-04-07T02:00:00.000Z',
      },
    ],
  });

  const updated = applyRevisionInlineNotesUpdate(revisions, payload);

  assert.deepEqual(updated[0], revisions[0]);
  assert.deepEqual(updated[1]?.inlineNotes, payload.inlineNotes);
  assert.equal(updated[1]?.content, revisions[1]?.content);
  assert.equal(updated[1]?.note, revisions[1]?.note);
});

test('revision inline note updates reject invalid payloads', () => {
  assert.throws(
    () =>
      parseRevisionInlineNotesUpdate({
        revisionId: '',
        inlineNotes: [],
      }),
    (error: unknown) =>
      error instanceof Error &&
      'status' in error &&
      error.status === 400 &&
      error.message === 'Invalid revisionId',
  );

  assert.throws(
    () =>
      parseRevisionInlineNotesUpdate({
        revisionId: 'rev-1',
        inlineNotes: [{ message: 123, lineNumber: 1 }],
      }),
    (error: unknown) =>
      error instanceof Error &&
      'status' in error &&
      error.status === 400 &&
      error.message === 'Inline note message must be a string',
  );

  assert.throws(
    () =>
      parseRevisionInlineNotesUpdate({
        revisionId: 'rev-1',
        inlineNotes: [{ message: 'bad line', lineNumber: 0 }],
      }),
    (error: unknown) =>
      error instanceof Error &&
      'status' in error &&
      error.status === 400 &&
      error.message === 'Inline note lineNumber must be null or a positive number',
  );
});

test('revision inline note updates fail cleanly when the revision does not exist', () => {
  const revisions: Revision[] = [
    {
      id: 'rev-1',
      createdAt: '2026-04-07T00:00:00.000Z',
      content: '# One',
      note: 'first',
      tags: [],
      status: 'Writing',
    },
  ];

  const payload = parseRevisionInlineNotesUpdate({
    revisionId: 'missing',
    inlineNotes: [],
  });

  assert.throws(
    () => applyRevisionInlineNotesUpdate(revisions, payload),
    (error: unknown) =>
      error instanceof Error &&
      'status' in error &&
      error.status === 404 &&
      error.message === 'Revision not found',
  );
});

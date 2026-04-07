import fs from 'fs';
import path from 'path';
import {
  CollaborationState,
  CreateDocumentInput,
  CreateRevisionInput,
  Document,
  DocumentBranchName,
  DocumentBranchState,
  DocumentDashboardEntry,
  DocumentMilestone,
  DocumentRevision,
  RevisionAuditEvent,
  RevisionComment,
  RevisionLock,
  RevisionMention,
  RevisionNotification,
  RevisionNote,
  RevisionPresence,
  RevisionStatus,
  ReviewRequest,
} from '@/types';
import { getBlobStore, isNetlifyRuntime } from '@/lib/netlifyRuntime';
import { getNotesDir, resolveSafePath } from '@/lib/notesPath';
import { listNoteFiles } from '@/lib/noteIndexStorage';
import { readRevisions } from '@/lib/revisionStorage';

const DOCUMENTS_DIRNAME = '.documents';
const DOCUMENT_META_KEY = 'document.json';
const REVISIONS_DIR = 'revisions';
const DOCUMENT_BRANCHES_KEY = 'branches.json';
const DOCUMENT_COMMENTS_DIR = 'comments';

function nowIso(): string {
  return new Date().toISOString();
}

function legacyFilenameToDocumentId(filename: string): string {
  return `legacy-${Buffer.from(filename).toString('base64url')}`;
}

function generateRevisionId(createdAt: string): string {
  const stamp = createdAt.replace(/[^0-9]/g, '').slice(0, 17);
  const random = Math.random().toString(36).slice(2, 10);
  return `${stamp}-${random}`;
}

function documentMetaBlobKey(documentId: string): string {
  return `documents/${documentId}/${DOCUMENT_META_KEY}`;
}

function documentRevisionBlobKey(documentId: string, revisionId: string): string {
  return `documents/${documentId}/${REVISIONS_DIR}/${revisionId}.json`;
}

function documentBranchesBlobKey(documentId: string): string {
  return `documents/${documentId}/${DOCUMENT_BRANCHES_KEY}`;
}

function documentCommentsBlobKey(documentId: string, revisionId: string): string {
  return `documents/${documentId}/${DOCUMENT_COMMENTS_DIR}/${revisionId}.json`;
}

function getDocumentsDir(): string {
  const base = getNotesDir();
  const dir = path.join(base, DOCUMENTS_DIRNAME);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getDocumentMetaPath(documentId: string): string {
  return path.join(getDocumentsDir(), documentId, DOCUMENT_META_KEY);
}

function getDocumentRevisionsDirPath(documentId: string): string {
  const dir = path.join(getDocumentsDir(), documentId, REVISIONS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getDocumentBranchesPath(documentId: string): string {
  return path.join(getDocumentsDir(), documentId, DOCUMENT_BRANCHES_KEY);
}

function getDocumentCommentsPath(documentId: string, revisionId: string): string {
  const dir = path.join(getDocumentsDir(), documentId, DOCUMENT_COMMENTS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${revisionId}.json`);
}

function validateDocumentId(documentId: string): void {
  if (!/^[a-zA-Z0-9_-]{3,128}$/.test(documentId)) {
    throw Object.assign(new Error('Invalid document ID'), { status: 400 });
  }
}

function ensureCollaborationState(
  collaboration: Partial<CollaborationState> | undefined,
): CollaborationState {
  return {
    presence: Array.isArray(collaboration?.presence) ? collaboration.presence : [],
    lock: collaboration?.lock ?? null,
    comments: Array.isArray(collaboration?.comments) ? collaboration.comments : [],
    reviewRequests: Array.isArray(collaboration?.reviewRequests) ? collaboration.reviewRequests : [],
    mentions: Array.isArray(collaboration?.mentions) ? collaboration.mentions : [],
    notifications: Array.isArray(collaboration?.notifications) ? collaboration.notifications : [],
    auditTrail: Array.isArray(collaboration?.auditTrail) ? collaboration.auditTrail : [],
  };
}

function ensureRevision(revision: DocumentRevision): DocumentRevision {
  return {
    ...revision,
    notes: Array.isArray(revision.notes) ? revision.notes : [],
    collaboration: ensureCollaborationState(revision.collaboration),
  };
}

function ensureBranchState(branches?: Partial<DocumentBranchState>): DocumentBranchState {
  return {
    draftRevisionId: branches?.draftRevisionId ?? null,
    acceptedRevisionId: branches?.acceptedRevisionId ?? null,
    canonicalRevisionId: branches?.canonicalRevisionId ?? null,
    milestones: Array.isArray(branches?.milestones) ? branches.milestones : [],
  };
}

function makeCollaborationId(prefix: string): string {
  return `${prefix}-${generateRevisionId(nowIso())}`;
}

function createAuditEvent(
  actorId: string,
  actorName: string,
  action: RevisionAuditEvent['action'],
  targetType?: RevisionAuditEvent['targetType'],
  targetId?: string,
  metadata?: Record<string, string>,
): RevisionAuditEvent {
  return {
    id: makeCollaborationId('audit'),
    actorId,
    actorName,
    action,
    targetType,
    targetId,
    createdAt: nowIso(),
    metadata,
  };
}

async function readDocumentRootRecord(documentId: string): Promise<Document> {
  validateDocumentId(documentId);
  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) throw Object.assign(new Error('Document not found'), { status: 404 });
    try {
      const buffer = await store.get(documentMetaBlobKey(documentId));
      if (!buffer) throw new Error('missing');
      return JSON.parse(new TextDecoder().decode(buffer)) as Document;
    } catch {
      throw Object.assign(new Error('Document not found'), { status: 404 });
    }
  }

  const metaPath = getDocumentMetaPath(documentId);
  if (!fs.existsSync(metaPath)) {
    throw Object.assign(new Error('Document not found'), { status: 404 });
  }
  return JSON.parse(fs.readFileSync(metaPath, 'utf8')) as Document;
}

async function documentExists(documentId: string): Promise<boolean> {
  try {
    await readDocumentRootRecord(documentId);
    return true;
  } catch {
    return false;
  }
}

async function readDocumentBranchState(documentId: string): Promise<DocumentBranchState> {
  validateDocumentId(documentId);
  await readDocumentRootRecord(documentId);
  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) return ensureBranchState();
    try {
      const raw = await store.get(documentBranchesBlobKey(documentId));
      if (!raw) return ensureBranchState();
      const parsed = JSON.parse(new TextDecoder().decode(raw)) as Partial<DocumentBranchState>;
      return ensureBranchState(parsed);
    } catch {
      return ensureBranchState();
    }
  }

  const branchPath = getDocumentBranchesPath(documentId);
  if (!fs.existsSync(branchPath)) return ensureBranchState();
  try {
    const parsed = JSON.parse(fs.readFileSync(branchPath, 'utf8')) as Partial<DocumentBranchState>;
    return ensureBranchState(parsed);
  } catch {
    return ensureBranchState();
  }
}

async function writeDocumentBranchState(documentId: string, branches: DocumentBranchState): Promise<void> {
  validateDocumentId(documentId);
  await readDocumentRootRecord(documentId);
  const normalized = ensureBranchState(branches);

  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) throw new Error('Could not save branch state');
    await store.set(documentBranchesBlobKey(documentId), JSON.stringify(normalized, null, 2));
    return;
  }

  const branchPath = getDocumentBranchesPath(documentId);
  fs.mkdirSync(path.dirname(branchPath), { recursive: true });
  fs.writeFileSync(branchPath, JSON.stringify(normalized, null, 2), 'utf8');
}

async function readRevisionDiscussion(documentId: string, revisionId: string): Promise<RevisionNote[]> {
  await getRevision(documentId, revisionId);
  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) return [];
    try {
      const raw = await store.get(documentCommentsBlobKey(documentId, revisionId));
      if (!raw) return [];
      const parsed = JSON.parse(new TextDecoder().decode(raw)) as RevisionNote[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  const commentPath = getDocumentCommentsPath(documentId, revisionId);
  if (!fs.existsSync(commentPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(commentPath, 'utf8')) as RevisionNote[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeRevisionDiscussion(documentId: string, revisionId: string, comments: RevisionNote[]): Promise<void> {
  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) throw new Error('Could not save comment');
    await store.set(documentCommentsBlobKey(documentId, revisionId), JSON.stringify(comments, null, 2));
    return;
  }

  const commentPath = getDocumentCommentsPath(documentId, revisionId);
  fs.writeFileSync(commentPath, JSON.stringify(comments, null, 2), 'utf8');
}

async function migrateLegacyFileToInitialRevision(filename: string): Promise<void> {
  const key = resolveSafePath(filename);
  let content = '';
  let createdAt = nowIso();

  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) return;
    try {
      const buffer = await store.get(key);
      if (!buffer) return;
      content = new TextDecoder().decode(buffer);
    } catch {
      return;
    }
  } else {
    if (!fs.existsSync(key)) return;
    const stat = fs.statSync(key);
    createdAt = stat.mtime.toISOString();
    content = fs.readFileSync(key, 'utf8');
  }

  const documentId = legacyFilenameToDocumentId(filename);
  if (await documentExists(documentId)) return;

  await createDocumentRootRecord({
    id: documentId,
    name: filename,
    sourceFilename: filename,
    createdAt,
  });
  await appendImmutableRevision(documentId, {
    content,
    createdAt,
    notes: [
      {
        id: generateRevisionId(createdAt),
        message: 'Migrated from legacy markdown file',
        createdAt,
      },
    ],
  });
}

export async function createDocumentRootRecord(input: CreateDocumentInput): Promise<Document> {
  const createdAt = input.createdAt ?? nowIso();
  validateDocumentId(input.id);
  const document: Document = {
    id: input.id,
    name: input.name,
    sourceFilename: input.sourceFilename,
    createdAt,
  };

  if (await documentExists(input.id)) {
    throw Object.assign(new Error('Document already exists'), { status: 409 });
  }

  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) throw new Error('Could not create document');
    await store.set(documentMetaBlobKey(input.id), JSON.stringify(document, null, 2));
    return document;
  }

  const metaPath = getDocumentMetaPath(input.id);
  fs.mkdirSync(path.dirname(metaPath), { recursive: true });
  fs.writeFileSync(metaPath, JSON.stringify(document, null, 2), 'utf8');
  return document;
}

export async function appendImmutableRevision(
  documentId: string,
  input: CreateRevisionInput,
): Promise<DocumentRevision> {
  validateDocumentId(documentId);
  await readDocumentRootRecord(documentId);

  const createdAt = input.createdAt ?? nowIso();
  const revisionId = generateRevisionId(createdAt);
  const collaboration = ensureCollaborationState(input.collaboration);

  const revision: DocumentRevision = {
    id: revisionId,
    documentId,
    createdAt,
    content: input.content,
    status: input.status,
    notes: input.notes ?? [],
    collaboration: {
      ...collaboration,
      auditTrail: [
        ...collaboration.auditTrail,
        createAuditEvent('system', 'System', 'revision-created', undefined, revisionId),
      ],
    },
  };

  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) throw new Error('Could not append revision');
    await store.set(documentRevisionBlobKey(documentId, revision.id), JSON.stringify(revision, null, 2));
    const branches = await readDocumentBranchState(documentId);
    if (!branches.draftRevisionId) {
      await writeDocumentBranchState(documentId, { ...branches, draftRevisionId: revision.id });
    }
    return revision;
  }

  const revisionsDir = getDocumentRevisionsDirPath(documentId);
  const revisionPath = path.join(revisionsDir, `${revision.id}.json`);
  fs.writeFileSync(revisionPath, JSON.stringify(revision, null, 2), 'utf8');
  const branches = await readDocumentBranchState(documentId);
  if (!branches.draftRevisionId) {
    await writeDocumentBranchState(documentId, { ...branches, draftRevisionId: revision.id });
  }
  return revision;
}

type CollaborationMutationInput = {
  actorId: string;
  actorName: string;
  presence?: RevisionPresence[];
  lock?: RevisionLock | null;
  addComment?: { message: string };
  requestReview?: { reviewerId: string; reviewerName: string; message?: string };
  mention?: { toUserId: string; message: string };
  markNotificationReadId?: string;
};

export async function listRevisionsByDocumentId(documentId: string): Promise<DocumentRevision[]> {
  validateDocumentId(documentId);
  await readDocumentRootRecord(documentId);

  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) return [];
    const prefix = `documents/${documentId}/${REVISIONS_DIR}/`;
    const { blobs } = await store.list({ prefix });
    const revisions: DocumentRevision[] = [];

    for (const blob of blobs) {
      if (!blob.key.endsWith('.json')) continue;
      const buffer = await store.get(blob.key);
      if (!buffer) continue;
      const parsed = JSON.parse(new TextDecoder().decode(buffer)) as DocumentRevision;
      revisions.push(ensureRevision(parsed));
    }

    return revisions.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  const revisionsDir = getDocumentRevisionsDirPath(documentId);
  if (!fs.existsSync(revisionsDir)) return [];

  return fs
    .readdirSync(revisionsDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => ensureRevision(JSON.parse(fs.readFileSync(path.join(revisionsDir, name), 'utf8')) as DocumentRevision))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getRevision(documentId: string, revisionId: string): Promise<DocumentRevision> {
  validateDocumentId(documentId);
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(revisionId)) {
    throw Object.assign(new Error('Invalid revision ID'), { status: 400 });
  }

  await readDocumentRootRecord(documentId);

  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) throw Object.assign(new Error('Revision not found'), { status: 404 });
    try {
      const buffer = await store.get(documentRevisionBlobKey(documentId, revisionId));
      if (!buffer) throw new Error('missing');
      return ensureRevision(JSON.parse(new TextDecoder().decode(buffer)) as DocumentRevision);
    } catch {
      throw Object.assign(new Error('Revision not found'), { status: 404 });
    }
  }

  const revisionPath = path.join(getDocumentRevisionsDirPath(documentId), `${revisionId}.json`);
  if (!fs.existsSync(revisionPath)) {
    throw Object.assign(new Error('Revision not found'), { status: 404 });
  }
  return ensureRevision(JSON.parse(fs.readFileSync(revisionPath, 'utf8')) as DocumentRevision);
}

export async function getDocumentBranchState(documentId: string): Promise<DocumentBranchState> {
  const branches = await readDocumentBranchState(documentId);
  const revisions = await listRevisionsByDocumentId(documentId);
  const latestRevisionId = revisions.at(-1)?.id ?? null;
  if (!branches.draftRevisionId && latestRevisionId) {
    const next = { ...branches, draftRevisionId: latestRevisionId };
    await writeDocumentBranchState(documentId, next);
    return next;
  }
  return branches;
}

export async function updateDocumentBranchState(
  documentId: string,
  patch: Partial<DocumentBranchState>,
): Promise<DocumentBranchState> {
  const current = await getDocumentBranchState(documentId);
  const next = ensureBranchState({
    ...current,
    ...patch,
    milestones: patch.milestones ?? current.milestones,
  });
  await writeDocumentBranchState(documentId, next);
  return next;
}

export async function promoteDocumentBranch(
  documentId: string,
  revisionId: string,
  branch: DocumentBranchName,
): Promise<DocumentBranchState> {
  await getRevision(documentId, revisionId);
  const branches = await getDocumentBranchState(documentId);
  const milestoneLabel =
    branch === 'canonical'
      ? 'Promoted to canonical version'
      : branch === 'accepted'
        ? 'Marked as accepted'
        : 'Set as draft head';
  const nextMilestones: DocumentMilestone[] = [
    ...branches.milestones,
    {
      id: generateRevisionId(nowIso()),
      revisionId,
      label: milestoneLabel,
      createdAt: nowIso(),
    },
  ];
  return updateDocumentBranchState(documentId, {
    ...branches,
    draftRevisionId: branch === 'draft' ? revisionId : branches.draftRevisionId,
    acceptedRevisionId: branch === 'accepted' ? revisionId : branches.acceptedRevisionId,
    canonicalRevisionId: branch === 'canonical' ? revisionId : branches.canonicalRevisionId,
    milestones: nextMilestones,
  });
}

export async function mutateRevisionCollaboration(
  documentId: string,
  revisionId: string,
  mutation: CollaborationMutationInput,
): Promise<DocumentRevision> {
  const revision = await getRevision(documentId, revisionId);
  const next = ensureRevision(revision);

  if (mutation.presence) {
    next.collaboration.presence = mutation.presence;
    next.collaboration.auditTrail.push(createAuditEvent(mutation.actorId, mutation.actorName, 'presence-updated'));
  }

  if (mutation.lock !== undefined) {
    const lockAction = mutation.lock ? 'lock-acquired' : 'lock-released';
    next.collaboration.lock = mutation.lock;
    next.collaboration.auditTrail.push(
      createAuditEvent(mutation.actorId, mutation.actorName, lockAction, 'lock', mutation.lock?.userId),
    );
  }

  if (mutation.addComment) {
    const comment: RevisionComment = {
      id: makeCollaborationId('comment'),
      authorId: mutation.actorId,
      authorName: mutation.actorName,
      message: mutation.addComment.message,
      createdAt: nowIso(),
    };
    next.collaboration.comments.push(comment);
    next.collaboration.auditTrail.push(
      createAuditEvent(mutation.actorId, mutation.actorName, 'comment-added', 'comment', comment.id),
    );
  }

  if (mutation.requestReview) {
    const reviewRequest: ReviewRequest = {
      id: makeCollaborationId('review'),
      requestedById: mutation.actorId,
      requestedByName: mutation.actorName,
      reviewerId: mutation.requestReview.reviewerId,
      reviewerName: mutation.requestReview.reviewerName,
      message: mutation.requestReview.message,
      status: 'pending',
      createdAt: nowIso(),
    };
    const notification: RevisionNotification = {
      id: makeCollaborationId('notification'),
      userId: mutation.requestReview.reviewerId,
      type: 'review-request',
      message: `${mutation.actorName} requested your review.`,
      createdAt: nowIso(),
    };
    next.collaboration.reviewRequests.push(reviewRequest);
    next.collaboration.notifications.push(notification);
    next.collaboration.auditTrail.push(
      createAuditEvent(mutation.actorId, mutation.actorName, 'review-requested', 'review-request', reviewRequest.id),
    );
  }

  if (mutation.mention) {
    const mention: RevisionMention = {
      id: makeCollaborationId('mention'),
      fromUserId: mutation.actorId,
      fromDisplayName: mutation.actorName,
      toUserId: mutation.mention.toUserId,
      message: mutation.mention.message,
      createdAt: nowIso(),
    };
    const notification: RevisionNotification = {
      id: makeCollaborationId('notification'),
      userId: mutation.mention.toUserId,
      type: 'mention',
      message: `${mutation.actorName} mentioned you: ${mutation.mention.message}`,
      createdAt: nowIso(),
    };
    next.collaboration.mentions.push(mention);
    next.collaboration.notifications.push(notification);
    next.collaboration.auditTrail.push(
      createAuditEvent(mutation.actorId, mutation.actorName, 'mention-added', 'mention', mention.id),
    );
  }

  if (mutation.markNotificationReadId) {
    next.collaboration.notifications = next.collaboration.notifications.map((notification) =>
      notification.id !== mutation.markNotificationReadId || notification.readAt
        ? notification
        : { ...notification, readAt: nowIso() },
    );
    next.collaboration.auditTrail.push(
      createAuditEvent(
        mutation.actorId,
        mutation.actorName,
        'notification-read',
        'notification',
        mutation.markNotificationReadId,
      ),
    );
  }

  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) throw new Error('Could not update collaboration state');
    await store.set(documentRevisionBlobKey(documentId, revisionId), JSON.stringify(next, null, 2));
    return next;
  }

  const revisionPath = path.join(getDocumentRevisionsDirPath(documentId), `${revisionId}.json`);
  fs.writeFileSync(revisionPath, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

export async function listRevisionComments(documentId: string, revisionId: string): Promise<RevisionNote[]> {
  const revision = await getRevision(documentId, revisionId);
  const sidecar = await readRevisionDiscussion(documentId, revisionId);
  return [...revision.notes, ...sidecar].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function addRevisionComment(
  documentId: string,
  revisionId: string,
  input: { message: string; parentId?: string },
): Promise<RevisionNote> {
  const trimmed = input.message.trim();
  if (!trimmed) {
    throw Object.assign(new Error('Comment message is required'), { status: 400 });
  }
  const comments = await readRevisionDiscussion(documentId, revisionId);
  const createdAt = nowIso();
  const comment: RevisionNote = {
    id: generateRevisionId(createdAt),
    message: trimmed,
    createdAt,
    parentId: input.parentId,
  };
  await writeRevisionDiscussion(documentId, revisionId, [...comments, comment]);
  return comment;
}

export async function listDocumentDashboardEntries(): Promise<DocumentDashboardEntry[]> {
  const files = await listNoteFiles();
  await Promise.all(files.map((file) => migrateLegacyFileToInitialRevision(file.name)));
  const documentIds = files.map((file) => legacyFilenameToDocumentId(file.name));

  const entries = await Promise.all(
    documentIds.map(async (documentId) => {
      try {
        const document = await readDocumentRootRecord(documentId);
        const revisions = await listRevisionsByDocumentId(documentId);
        const sourceRevisions = document.sourceFilename ? await readRevisions(document.sourceFilename) : [];
        const statusByContent = new Map<string, RevisionStatus | undefined>(
          sourceRevisions.map((revision) => [revision.content, revision.status]),
        );
        const revisionsWithThreads = await Promise.all(
          revisions.map(async (revision) => ({
            ...revision,
            status: revision.status ?? statusByContent.get(revision.content),
            notes: await listRevisionComments(documentId, revision.id),
          })),
        );
        const branches = await getDocumentBranchState(documentId);
        return { document, revisions: revisionsWithThreads, branches } satisfies DocumentDashboardEntry;
      } catch {
        return null;
      }
    }),
  );

  return entries.flatMap((entry) => (entry ? [entry] : []));
}

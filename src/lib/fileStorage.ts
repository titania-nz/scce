import fs from 'fs';
import path from 'path';
import {
  CollaborationState,
  CreateDocumentInput,
  CreateRevisionInput,
  Document,
  DocumentRevision,
  FileEntry,
  RevisionAuditEvent,
  RevisionComment,
  ReviewRequest,
  RevisionEntry,
  RevisionLock,
  RevisionMention,
  RevisionNotification,
  RevisionPresence,
} from '@/types';
import { isNetlifyRuntime, getBlobStore } from '@/lib/netlifyRuntime';

const VALID_FILENAME = /^[a-zA-Z0-9_\-. /]+\.md$/;
const MAX_FILENAME_LENGTH = 255;

const DOCUMENTS_DIRNAME = '.documents';
const DOCUMENT_META_KEY = 'document.json';
const REVISIONS_DIR = 'revisions';

interface FileRevisionMeta {
  currentDraftRevisionId: string | null;
  revisions: RevisionEntry[];
}

interface BlobFileMetaRecord {
  createdAt: string;
  updatedAt: string;
  size: number;
}

const EMPTY_META: FileRevisionMeta = {
  currentDraftRevisionId: null,
  revisions: [],
};

function encodeFilenameForPath(filename: string): string {
  return encodeURIComponent(filename);
}

function makeRevisionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Helper function: keeps a small, testable transformation isolated from UI side effects.
function parseRevisionKeyTimestamp(revisionId: string): number {
  const ts = Number(revisionId.split('-')[0]);
  return Number.isFinite(ts) ? ts : 0;
}

function sortRevisionsDesc(a: RevisionEntry, b: RevisionEntry): number {
  return parseRevisionKeyTimestamp(b.id) - parseRevisionKeyTimestamp(a.id);
}

function getRevisionMetaPath(filename: string): string {
  const notesDir = getNotesDir();
  return path.join(notesDir, '.revisions', `${encodeFilenameForPath(filename)}.json`);
}

function getRevisionContentPath(filename: string, revisionId: string): string {
  const notesDir = getNotesDir();
  return path.join(notesDir, '.revisions', encodeFilenameForPath(filename), `${revisionId}.md`);
}

function getRevisionMetaKey(filename: string): string {
  return `__revisions__/${encodeFilenameForPath(filename)}.json`;
}

function getRevisionContentKey(filename: string, revisionId: string): string {
  return `__revisions__/${encodeFilenameForPath(filename)}/${revisionId}.md`;
}

function getBlobFileMetaKey(filename: string): string {
  return `__filemeta__/${encodeFilenameForPath(filename)}.json`;
}

function buildBlobFileMetaRecord(existing: BlobFileMetaRecord | null, size: number): BlobFileMetaRecord {
  const timestamp = nowIso();
  return {
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    size,
  };
}

async function readBlobFileMeta(filename: string): Promise<BlobFileMetaRecord | null> {
  const store = getBlobStore();
  if (!store) return null;
  try {
    const buffer = await store.get(getBlobFileMetaKey(filename));
    if (!buffer) return null;
    const parsed = JSON.parse(new TextDecoder().decode(buffer)) as Partial<BlobFileMetaRecord>;
    if (!parsed.updatedAt && !parsed.createdAt) return null;
    return {
      createdAt: parsed.createdAt ?? parsed.updatedAt ?? nowIso(),
      updatedAt: parsed.updatedAt ?? parsed.createdAt ?? nowIso(),
      size: Number.isFinite(parsed.size) ? Number(parsed.size) : 0,
    };
  } catch {
    return null;
  }
}

async function writeBlobFileMeta(filename: string, meta: BlobFileMetaRecord): Promise<void> {
  const store = getBlobStore();
  if (!store) throw new Error('Could not write file metadata');
  await store.set(getBlobFileMetaKey(filename), JSON.stringify(meta));
}

async function deleteBlobFileMeta(filename: string): Promise<void> {
  const store = getBlobStore();
  if (!store) return;
  await store.delete(getBlobFileMetaKey(filename)).catch(() => {});
}

function ensureLocalRevisionDirs(filename: string): void {
  const metaPath = getRevisionMetaPath(filename);
  fs.mkdirSync(path.dirname(metaPath), { recursive: true });
  fs.mkdirSync(path.dirname(getRevisionContentPath(filename, 'placeholder')), { recursive: true });
}

async function readRevisionMeta(filename: string): Promise<FileRevisionMeta> {
  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) return { ...EMPTY_META };

    try {
      const buffer = await store.get(getRevisionMetaKey(filename));
      if (!buffer) return { ...EMPTY_META };
      const parsed = JSON.parse(new TextDecoder().decode(buffer)) as FileRevisionMeta;
      return {
        currentDraftRevisionId: parsed.currentDraftRevisionId ?? null,
        revisions: (parsed.revisions ?? []).slice().sort(sortRevisionsDesc),
      };
    } catch {
      return { ...EMPTY_META };
    }
  }

  const metaPath = getRevisionMetaPath(filename);
  if (!fs.existsSync(metaPath)) return { ...EMPTY_META };

  try {
    const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as FileRevisionMeta;
    return {
      currentDraftRevisionId: parsed.currentDraftRevisionId ?? null,
      revisions: (parsed.revisions ?? []).slice().sort(sortRevisionsDesc),
    };
  } catch {
    return { ...EMPTY_META };
  }
}

async function writeRevisionMeta(filename: string, meta: FileRevisionMeta): Promise<void> {
  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) throw new Error('Could not update revision metadata');
    await store.set(getRevisionMetaKey(filename), JSON.stringify(meta));
    return;
  }

  ensureLocalRevisionDirs(filename);
  fs.writeFileSync(getRevisionMetaPath(filename), JSON.stringify(meta), 'utf-8');
}

async function readRevisionContent(filename: string, revisionId: string): Promise<string> {
  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) {
      throw Object.assign(new Error('Revision not found'), { status: 404 });
    }
    try {
      const buffer = await store.get(getRevisionContentKey(filename, revisionId));
      if (!buffer) throw new Error('missing');
      return new TextDecoder().decode(buffer);
    } catch {
      throw Object.assign(new Error('Revision not found'), { status: 404 });
    }
  }

  const revPath = getRevisionContentPath(filename, revisionId);
  if (!fs.existsSync(revPath)) {
    throw Object.assign(new Error('Revision not found'), { status: 404 });
  }
  return fs.readFileSync(revPath, 'utf-8');
}

async function writeRevisionContent(filename: string, revisionId: string, content: string): Promise<void> {
  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) throw new Error('Could not write revision');
    await store.set(getRevisionContentKey(filename, revisionId), content);
    return;
  }

  ensureLocalRevisionDirs(filename);
  fs.writeFileSync(getRevisionContentPath(filename, revisionId), content, 'utf-8');
}

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

function validateDocumentId(documentId: string): void {
  if (!/^[a-zA-Z0-9_-]{3,128}$/.test(documentId)) {
    throw Object.assign(new Error('Invalid document ID'), { status: 400 });
  }
}

function ensureRevision(revision: DocumentRevision): DocumentRevision {
  return {
    ...revision,
    notes: Array.isArray(revision.notes) ? revision.notes : [],
    collaboration: ensureCollaborationState(revision.collaboration),
  };
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
    const filePath = key;
    if (!fs.existsSync(filePath)) {
      return;
    }
    const stat = fs.statSync(filePath);
    createdAt = stat.mtime.toISOString();
    content = fs.readFileSync(filePath, 'utf8');
  }

  const documentId = legacyFilenameToDocumentId(filename);
  const exists = await documentExists(documentId);
  if (exists) return;

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

// Public hook/helper: called from UI code to encapsulate shared stateful behavior.
export function getNotesDir(): string {
  if (isNetlifyRuntime) {
    return '';
  }
  const dir = process.env.NOTES_DIR ?? './notes';
  /*turbopackIgnore: true*/ fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Public hook/helper: called from UI code to encapsulate shared stateful behavior.
export function resolveSafePath(filename: string): string {
  if (!filename || filename.length > MAX_FILENAME_LENGTH) {
    throw Object.assign(new Error('Invalid filename'), { status: 400 });
  }
  if (!VALID_FILENAME.test(filename)) {
    throw Object.assign(new Error('Invalid filename'), { status: 400 });
  }
  if (filename.includes('\\')) {
    throw Object.assign(new Error('Invalid filename'), { status: 400 });
  }
  const segments = filename.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw Object.assign(new Error('Invalid filename'), { status: 400 });
  }
  if (isNetlifyRuntime) {
    return filename;
  }
  const notesDir = getNotesDir();
  const resolved = path.resolve(notesDir, filename);
  if (!resolved.startsWith(path.resolve(notesDir) + path.sep)) {
    throw Object.assign(new Error('Invalid filename'), { status: 400 });
  }
  return resolved;
}

async function documentExists(documentId: string): Promise<boolean> {
  try {
    await readDocumentRootRecord(documentId);
    return true;
  } catch {
    return false;
  }
}

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
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

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
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
    return revision;
  }

  const revisionsDir = getDocumentRevisionsDirPath(documentId);
  const revisionPath = path.join(revisionsDir, `${revision.id}.json`);
  fs.writeFileSync(revisionPath, JSON.stringify(revision, null, 2), 'utf8');
  return revision;
}

type CollaborationMutationInput = {
  actorId: string;
  actorName: string;
  presence?: RevisionPresence[];
  lock?: RevisionLock | null;
  addComment?: {
    message: string;
  };
  requestReview?: {
    reviewerId: string;
    reviewerName: string;
    message?: string;
  };
  mention?: {
    toUserId: string;
    message: string;
  };
  markNotificationReadId?: string;
};

export async function mutateRevisionCollaboration(
  documentId: string,
  revisionId: string,
  mutation: CollaborationMutationInput,
): Promise<DocumentRevision> {
  const revision = await getRevision(documentId, revisionId);
  const next = ensureRevision(revision);

  if (mutation.presence) {
    next.collaboration.presence = mutation.presence;
    next.collaboration.auditTrail.push(
      createAuditEvent(mutation.actorId, mutation.actorName, 'presence-updated'),
    );
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
      createAuditEvent(
        mutation.actorId,
        mutation.actorName,
        'review-requested',
        'review-request',
        reviewRequest.id,
      ),
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
    next.collaboration.notifications = next.collaboration.notifications.map((notification) => {
      if (notification.id !== mutation.markNotificationReadId || notification.readAt) {
        return notification;
      }
      return {
        ...notification,
        readAt: nowIso(),
      };
    });
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

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
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
  if (!fs.existsSync(revisionsDir)) {
    return [];
  }

  return fs
    .readdirSync(revisionsDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const revisionPath = path.join(revisionsDir, name);
      const raw = JSON.parse(fs.readFileSync(revisionPath, 'utf8')) as DocumentRevision;
      return ensureRevision(raw);
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
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
      return ensureRevision(JSON.parse(new TextDecoder().decode(buffer)) as DocumentRevision);
    } catch {
      throw Object.assign(new Error('Revision not found'), { status: 404 });
    }
  }

  const revisionPath = path.join(getDocumentRevisionsDirPath(documentId), `${revisionId}.json`);
  if (!fs.existsSync(revisionPath)) {
    throw Object.assign(new Error('Revision not found'), { status: 404 });
  }
  const revision = JSON.parse(fs.readFileSync(revisionPath, 'utf8')) as DocumentRevision;
  return ensureRevision(revision);
}

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function listFiles(): Promise<FileEntry[]> {
  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) return [];
    const { blobs } = await store.list();
    const files = await Promise.all(
      blobs
      .filter(
        (blob) =>
          blob.key.endsWith('.md') &&
          !blob.key.startsWith('__revisions__/') &&
          !blob.key.startsWith('__filemeta__/') &&
          !blob.key.startsWith('documents/') &&
          VALID_FILENAME.test(blob.key),
      )
      .map(async (blob) => {
        const meta = await readBlobFileMeta(blob.key);
        const fallback = nowIso();
        return {
          name: blob.key,
          mtime: meta?.updatedAt ?? fallback,
          ctime: meta?.createdAt ?? fallback,
          size: meta?.size ?? 0,
        };
      }),
    );

    return files.sort((a, b) => a.name.localeCompare(b.name));
  }

  const dir = getNotesDir();
  const files: FileEntry[] = [];

  const walk = (relativeDir = ''): void => {
    const currentDir = path.join(dir, relativeDir);
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const nextRelative = relativeDir ? path.posix.join(relativeDir, entry.name) : entry.name;
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) {
          continue;
        }
        walk(nextRelative);
        continue;
      }

      if (!entry.isFile() || !nextRelative.endsWith('.md') || !VALID_FILENAME.test(nextRelative)) {
        continue;
      }

      const stat = fs.statSync(path.join(dir, nextRelative));
      files.push({
        name: nextRelative,
        mtime: stat.mtime.toISOString(),
        ctime: stat.birthtime.toISOString(),
        size: stat.size,
      });
    }
  };

  walk();

  return files.sort((a, b) => a.name.localeCompare(b.name));
}

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function readFile(filename: string): Promise<string> {
  const key = resolveSafePath(filename);
  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) throw Object.assign(new Error('File not found'), { status: 404 });
    try {
      const buffer = await store.get(key);
      if (!buffer) throw new Error('missing');
      return new TextDecoder().decode(buffer);
    } catch {
      throw Object.assign(new Error('File not found'), { status: 404 });
    }
  }

  const filePath = key;
  if (!fs.existsSync(filePath)) {
    throw Object.assign(new Error('File not found'), { status: 404 });
  }
  return fs.readFileSync(filePath, 'utf-8');
}

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function writeFile(filename: string, content: string): Promise<void> {
  const key = resolveSafePath(filename);
  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) throw new Error('Could not create file');
    await store.set(key, content);
    const previousMeta = await readBlobFileMeta(filename);
    const size = Buffer.byteLength(content, 'utf-8');
    await writeBlobFileMeta(filename, buildBlobFileMetaRecord(previousMeta, size));
  } else {
    const filePath = key;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  }

}

async function removeRevisionData(filename: string): Promise<void> {
  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) return;
    const { blobs } = await store.list({ prefix: `__revisions__/${encodeFilenameForPath(filename)}/` });
    await Promise.all(blobs.map((blob) => store.delete(blob.key)));
    await store.delete(getRevisionMetaKey(filename)).catch(() => {});
    return;
  }

  const revDir = path.dirname(getRevisionContentPath(filename, 'placeholder'));
  if (fs.existsSync(revDir)) {
    fs.rmSync(revDir, { recursive: true, force: true });
  }
  const metaPath = getRevisionMetaPath(filename);
  if (fs.existsSync(metaPath)) {
    fs.unlinkSync(metaPath);
  }
}

async function copyRevisionData(oldName: string, newName: string): Promise<void> {
  const meta = await readRevisionMeta(oldName);
  if (meta.revisions.length === 0) return;

  for (const revision of meta.revisions) {
    const content = await readRevisionContent(oldName, revision.id);
    await writeRevisionContent(newName, revision.id, content);
  }
  await writeRevisionMeta(newName, meta);
}

async function removeDocumentData(filename: string): Promise<void> {
  const documentId = legacyFilenameToDocumentId(filename);
  if (!(await documentExists(documentId))) return;

  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) return;
    const prefix = `documents/${documentId}/`;
    const { blobs } = await store.list({ prefix });
    await Promise.all(blobs.map((blob) => store.delete(blob.key)));
    return;
  }

  const docDir = path.join(getDocumentsDir(), documentId);
  if (fs.existsSync(docDir)) {
    fs.rmSync(docDir, { recursive: true, force: true });
  }
}

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function deleteFile(filename: string): Promise<void> {
  const key = resolveSafePath(filename);
  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) throw Object.assign(new Error('File not found'), { status: 404 });
    const existing = await store.get(key);
    if (!existing) throw Object.assign(new Error('File not found'), { status: 404 });
    await store.delete(key);
    await deleteBlobFileMeta(filename);
    await removeRevisionData(filename);
    await removeDocumentData(filename);
    return;
  }
  const filePath = key;
  if (!fs.existsSync(filePath)) {
    throw Object.assign(new Error('File not found'), { status: 404 });
  }
  fs.unlinkSync(filePath);
  await removeRevisionData(filename);
  await removeDocumentData(filename);
}

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function renameFile(oldName: string, newName: string): Promise<void> {
  const oldKey = resolveSafePath(oldName);
  const newKey = resolveSafePath(newName);
  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) throw Object.assign(new Error('File not found'), { status: 404 });
    const existing = await store.get(oldKey);
    if (!existing) throw Object.assign(new Error('File not found'), { status: 404 });
    const newExists = await store.get(newKey);
    if (newExists) throw Object.assign(new Error('File already exists'), { status: 409 });
    const content = typeof existing === 'string' ? existing : new TextDecoder().decode(existing as ArrayBuffer);
    await store.set(newKey, content);
    const previousMeta = await readBlobFileMeta(oldName);
    const size = Buffer.byteLength(content, 'utf-8');
    await writeBlobFileMeta(newName, buildBlobFileMetaRecord(previousMeta, size));
    await copyRevisionData(oldName, newName);
    await store.delete(oldKey);
    await deleteBlobFileMeta(oldName);
    await removeRevisionData(oldName);
  } else {
    const oldPath = oldKey;
    const newPath = newKey;
    if (!fs.existsSync(oldPath)) {
      throw Object.assign(new Error('File not found'), { status: 404 });
    }
    if (fs.existsSync(newPath)) {
      throw Object.assign(new Error('File already exists'), { status: 409 });
    }
    fs.mkdirSync(path.dirname(newPath), { recursive: true });
    fs.renameSync(oldPath, newPath);
    await copyRevisionData(oldName, newName);
    await removeRevisionData(oldName);
  }

  const oldDocumentId = legacyFilenameToDocumentId(oldName);
  const newDocumentId = legacyFilenameToDocumentId(newName);

  if (await documentExists(oldDocumentId)) {
    const revisions = await listRevisionsByDocumentId(oldDocumentId);
    if (!(await documentExists(newDocumentId))) {
      await createDocumentRootRecord({
        id: newDocumentId,
        name: newName,
        sourceFilename: newName,
      });
    }

    if (revisions.length > 0) {
      const latest = revisions[revisions.length - 1];
      const renameTimestamp = nowIso();
      await appendImmutableRevision(newDocumentId, {
        content: latest.content,
        notes: [
          {
            id: generateRevisionId(renameTimestamp),
            message: `Renamed from ${oldName}`,
            createdAt: renameTimestamp,
          },
        ],
      });
    }

    await removeDocumentData(oldName);
  }
}

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function fileExists(filename: string): Promise<boolean> {
  try {
    const key = resolveSafePath(filename);
    if (isNetlifyRuntime) {
      const store = getBlobStore();
      if (!store) return false;
      try {
        const blob = await store.get(key);
        return blob !== null;
      } catch {
        return false;
      }
    }
    const filePath = key;
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function createRevision(
  filename: string,
  content: string,
  options?: { setAsDraft?: boolean },
): Promise<RevisionEntry> {
  resolveSafePath(filename);
  const setAsDraft = options?.setAsDraft ?? true;
  const revision: RevisionEntry = {
    id: makeRevisionId(),
    createdAt: new Date().toISOString(),
    size: Buffer.byteLength(content, 'utf-8'),
  };

  await writeRevisionContent(filename, revision.id, content);

  const meta = await readRevisionMeta(filename);
  const nextMeta: FileRevisionMeta = {
    currentDraftRevisionId: setAsDraft ? revision.id : meta.currentDraftRevisionId,
    revisions: [revision, ...meta.revisions].sort(sortRevisionsDesc),
  };

  await writeRevisionMeta(filename, nextMeta);

  return revision;
}

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function ensureDraftRevision(filename: string): Promise<FileRevisionMeta> {
  resolveSafePath(filename);
  const meta = await readRevisionMeta(filename);
  if (meta.currentDraftRevisionId && meta.revisions.some((rev) => rev.id === meta.currentDraftRevisionId)) {
    return meta;
  }

  const content = await readFile(filename);
  const bootstrapRevision = await createRevision(filename, content, { setAsDraft: true });
  return {
    currentDraftRevisionId: bootstrapRevision.id,
    revisions: [bootstrapRevision, ...meta.revisions].sort(sortRevisionsDesc),
  };
}

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function listRevisions(filename: string): Promise<FileRevisionMeta> {
  return ensureDraftRevision(filename);
}

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function readRevision(filename: string, revisionId: string): Promise<string> {
  resolveSafePath(filename);
  return readRevisionContent(filename, revisionId);
}

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function getCurrentDraftContent(filename: string): Promise<{ content: string; revisionId: string | null }> {
  const meta = await ensureDraftRevision(filename);
  if (!meta.currentDraftRevisionId) {
    return { content: await readFile(filename), revisionId: null };
  }

  const content = await readRevision(filename, meta.currentDraftRevisionId);
  return { content, revisionId: meta.currentDraftRevisionId };
}

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function promoteRevisionToDraft(filename: string, revisionId: string): Promise<void> {
  resolveSafePath(filename);
  const meta = await ensureDraftRevision(filename);
  const target = meta.revisions.find((rev) => rev.id === revisionId);
  if (!target) {
    throw Object.assign(new Error('Revision not found'), { status: 404 });
  }

  const content = await readRevision(filename, revisionId);
  await writeFile(filename, content);
  await writeRevisionMeta(filename, {
    ...meta,
    currentDraftRevisionId: revisionId,
  });
}

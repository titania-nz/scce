import fs from 'fs';
import path from 'path';
import { getStore } from '@netlify/blobs';
import {
  CreateDocumentInput,
  CreateRevisionInput,
  Document,
  DocumentRevision,
  FileEntry,
  RevisionEntry,
} from '@/types';

const VALID_FILENAME = /^[a-zA-Z0-9_\-. ]+\.md$/;
const MAX_FILENAME_LENGTH = 255;

const DOCUMENTS_DIRNAME = '.documents';
const DOCUMENT_META_KEY = 'document.json';
const REVISIONS_DIR = 'revisions';

const isNetlifyRuntime =
  process.env.NETLIFY === 'true' ||
  process.env.CONTEXT !== undefined ||
  process.env.NETLIFY_BLOBS_CONTEXT !== undefined;

interface FileRevisionMeta {
  currentDraftRevisionId: string | null;
  revisions: RevisionEntry[];
}

const EMPTY_META: FileRevisionMeta = {
  currentDraftRevisionId: null,
  revisions: [],
};

function getBlobStore() {
  if (!isNetlifyRuntime) {
    return null;
  }
  return getStore('files');
}

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
  };
}

async function readDocumentRootRecord(documentId: string): Promise<Document> {
  validateDocumentId(documentId);
  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) throw Object.assign(new Error('Document not found'), { status: 404 });
    try {
      const buffer = await store.get(documentMetaBlobKey(documentId));
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
  const dir = process.env.NOTES_DIR ?? path.join(process.cwd(), 'notes');
  fs.mkdirSync(dir, { recursive: true });
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

  const revision: DocumentRevision = {
    id: revisionId,
    documentId,
    createdAt,
    content: input.content,
    notes: input.notes ?? [],
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
    const files = blobs
      .filter((blob) => blob.key.endsWith('.md') && VALID_FILENAME.test(blob.key))
      .map((blob) => ({
        name: blob.key,
        mtime: new Date().toISOString(),
        ctime: new Date().toISOString(),

        size: 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const file of files) {
      await migrateLegacyFileToInitialRevision(file.name);
    }

    return files;
  }

  const dir = getNotesDir();
  const entries = fs.readdirSync(dir);
  const files = entries
    .filter((name) => name.endsWith('.md') && VALID_FILENAME.test(name))
    .map((name) => {
      const stat = fs.statSync(path.join(dir, name));
      return {
        name,
        mtime: stat.mtime.toISOString(),
        ctime: stat.birthtime.toISOString(),
        size: stat.size,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const file of files) {
    await migrateLegacyFileToInitialRevision(file.name);
  }

  return files;
}

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function readFile(filename: string): Promise<string> {
  await migrateLegacyFileToInitialRevision(filename);

  const documentId = legacyFilenameToDocumentId(filename);
  const revisions = await listRevisionsByDocumentId(documentId);
  const latest = revisions[revisions.length - 1];
  if (latest) {
    return latest.content;
  }

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
  await migrateLegacyFileToInitialRevision(filename);

  const key = resolveSafePath(filename);
  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) throw new Error('Could not create file');
    await store.set(key, content);
  } else {
    const filePath = key;
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  }

  const documentId = legacyFilenameToDocumentId(filename);
  if (!(await documentExists(documentId))) {
    await createDocumentRootRecord({
      id: documentId,
      name: filename,
      sourceFilename: filename,
    });
  }

  await appendImmutableRevision(documentId, {
    content,
    notes: [
      {
        id: generateRevisionId(nowIso()),
        message: 'Created from file API write',
        createdAt: nowIso(),
      },
    ],
  });
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

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function deleteFile(filename: string): Promise<void> {
  const key = resolveSafePath(filename);
  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) throw Object.assign(new Error('File not found'), { status: 404 });
    try {
      await store.delete(key);
      await removeRevisionData(filename);
    } catch {
      throw Object.assign(new Error('File not found'), { status: 404 });
    }
    return;
  }
  const filePath = key;
  if (!fs.existsSync(filePath)) {
    throw Object.assign(new Error('File not found'), { status: 404 });
  }
  fs.unlinkSync(filePath);
  await removeRevisionData(filename);
}

// API handler: validates input, calls storage helpers, and returns an HTTP JSON response.
export async function renameFile(oldName: string, newName: string): Promise<void> {
  const oldKey = resolveSafePath(oldName);
  const newKey = resolveSafePath(newName);
  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) throw Object.assign(new Error('File not found'), { status: 404 });
    try {
      const buffer = await store.get(oldKey);
      if (!buffer) throw new Error('missing');
      const content = new TextDecoder().decode(buffer);
      await store.set(newKey, content);
      await copyRevisionData(oldName, newName);
      await store.delete(oldKey);
      await removeRevisionData(oldName);
    } catch {
      throw Object.assign(new Error('File not found'), { status: 404 });
    }
  } else {
    const oldPath = oldKey;
    const newPath = newKey;
    if (!fs.existsSync(oldPath)) {
      throw Object.assign(new Error('File not found'), { status: 404 });
    }
    if (fs.existsSync(newPath)) {
      throw Object.assign(new Error('File already exists'), { status: 409 });
    }
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
      await appendImmutableRevision(newDocumentId, {
        content: latest.content,
        notes: [
          {
            id: generateRevisionId(nowIso()),
            message: `Renamed from ${oldName}`,
            createdAt: nowIso(),
          },
        ],
      });
    }
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
  if (setAsDraft) {
    await writeFile(filename, content);
  }

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

import fs from 'fs';
import path from 'path';
import { getStore } from '@netlify/blobs';
import { CreateDocumentInput, CreateRevisionInput, Document, FileEntry, Revision } from '@/types';

const VALID_FILENAME = /^[a-zA-Z0-9_\-. ]+\.md$/;
const MAX_FILENAME_LENGTH = 255;

const DOCUMENTS_DIRNAME = '.documents';
const DOCUMENT_META_KEY = 'document.json';
const REVISIONS_DIR = 'revisions';

const isNetlifyRuntime =
  process.env.NETLIFY === 'true' ||
  process.env.CONTEXT !== undefined ||
  process.env.NETLIFY_BLOBS_CONTEXT !== undefined;

function getBlobStore() {
  if (!isNetlifyRuntime) {
    return null;
  }
  return getStore('files');
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

function ensureRevision(revision: Revision): Revision {
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

export function getNotesDir(): string {
  if (isNetlifyRuntime) {
    return '';
  }
  const dir = process.env.NOTES_DIR ?? path.join(process.cwd(), 'notes');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

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
): Promise<Revision> {
  validateDocumentId(documentId);
  await readDocumentRootRecord(documentId);

  const createdAt = input.createdAt ?? nowIso();
  const revisionId = generateRevisionId(createdAt);

  const revision: Revision = {
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

export async function listRevisionsByDocumentId(documentId: string): Promise<Revision[]> {
  validateDocumentId(documentId);
  await readDocumentRootRecord(documentId);

  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) return [];
    const prefix = `documents/${documentId}/${REVISIONS_DIR}/`;
    const { blobs } = await store.list({ prefix });
    const revisions: Revision[] = [];

    for (const blob of blobs) {
      if (!blob.key.endsWith('.json')) continue;
      const buffer = await store.get(blob.key);
      const parsed = JSON.parse(new TextDecoder().decode(buffer)) as Revision;
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
      const raw = JSON.parse(fs.readFileSync(revisionPath, 'utf8')) as Revision;
      return ensureRevision(raw);
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getRevision(documentId: string, revisionId: string): Promise<Revision> {
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
      return ensureRevision(JSON.parse(new TextDecoder().decode(buffer)) as Revision);
    } catch {
      throw Object.assign(new Error('Revision not found'), { status: 404 });
    }
  }

  const revisionPath = path.join(getDocumentRevisionsDirPath(documentId), `${revisionId}.json`);
  if (!fs.existsSync(revisionPath)) {
    throw Object.assign(new Error('Revision not found'), { status: 404 });
  }
  const revision = JSON.parse(fs.readFileSync(revisionPath, 'utf8')) as Revision;
  return ensureRevision(revision);
}

export async function listFiles(): Promise<FileEntry[]> {
  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) return [];
    const { blobs } = await store.list();
    const files = blobs
      .filter((blob) => blob.key.endsWith('.md') && VALID_FILENAME.test(blob.key))
      .map((blob) => ({
        name: blob.key,
        mtime: nowIso(),
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
      return { name, mtime: stat.mtime.toISOString(), size: stat.size };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const file of files) {
    await migrateLegacyFileToInitialRevision(file.name);
  }

  return files;
}

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

export async function deleteFile(filename: string): Promise<void> {
  const key = resolveSafePath(filename);
  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) throw Object.assign(new Error('File not found'), { status: 404 });
    try {
      await store.delete(key);
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
}

export async function renameFile(oldName: string, newName: string): Promise<void> {
  const oldKey = resolveSafePath(oldName);
  const newKey = resolveSafePath(newName);
  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) throw Object.assign(new Error('File not found'), { status: 404 });
    try {
      const buffer = await store.get(oldKey);
      const content = new TextDecoder().decode(buffer);
      await store.set(newKey, content);
      await store.delete(oldKey);
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

export async function fileExists(filename: string): Promise<boolean> {
  try {
    const key = resolveSafePath(filename);
    if (isNetlifyRuntime) {
      const store = getBlobStore();
      if (!store) return false;
      try {
        await store.get(key);
        return true;
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

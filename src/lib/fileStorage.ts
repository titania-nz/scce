import fs from 'fs';
import path from 'path';
import { getStore } from '@netlify/blobs';
import { FileEntry, RevisionEntry } from '@/types';

const VALID_FILENAME = /^[a-zA-Z0-9_\-. ]+\.md$/;
const MAX_FILENAME_LENGTH = 255;

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

export function getNotesDir(): string {
  if (isNetlifyRuntime) {
    return ''; // Not used
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
    return filename; // Just return the filename for blob store
  }
  const notesDir = getNotesDir();
  const resolved = path.resolve(notesDir, filename);
  if (!resolved.startsWith(path.resolve(notesDir) + path.sep)) {
    throw Object.assign(new Error('Invalid filename'), { status: 400 });
  }
  return resolved;
}

export async function listFiles(): Promise<FileEntry[]> {
  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) return [];
    const { blobs } = await store.list();
    return blobs
      .filter((blob) => blob.key.endsWith('.md') && VALID_FILENAME.test(blob.key))
      .map((blob) => ({
        name: blob.key,
        mtime: new Date().toISOString(),
        size: 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  const dir = getNotesDir();
  const entries = fs.readdirSync(dir);
  return entries
    .filter((name) => name.endsWith('.md') && VALID_FILENAME.test(name))
    .map((name) => {
      const stat = fs.statSync(path.join(dir, name));
      return { name, mtime: stat.mtime.toISOString(), size: stat.size };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

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

export async function writeFile(filename: string, content: string): Promise<void> {
  const key = resolveSafePath(filename);
  if (isNetlifyRuntime) {
    const store = getBlobStore();
    if (!store) throw new Error('Could not create file');
    await store.set(key, content);
    return;
  }
  const filePath = key;
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, content, 'utf-8');
  fs.renameSync(tmpPath, filePath);
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
    return;
  }
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

export async function listRevisions(filename: string): Promise<FileRevisionMeta> {
  return ensureDraftRevision(filename);
}

export async function readRevision(filename: string, revisionId: string): Promise<string> {
  resolveSafePath(filename);
  return readRevisionContent(filename, revisionId);
}

export async function getCurrentDraftContent(filename: string): Promise<{ content: string; revisionId: string | null }> {
  const meta = await ensureDraftRevision(filename);
  if (!meta.currentDraftRevisionId) {
    return { content: await readFile(filename), revisionId: null };
  }

  const content = await readRevision(filename, meta.currentDraftRevisionId);
  return { content, revisionId: meta.currentDraftRevisionId };
}

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
